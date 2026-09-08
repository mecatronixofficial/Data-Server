import {
  BadRequestException,
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'production' && !process.env.MONGODB_URI) {
      const existing = await this.userModel.exists({ role: 'superadmin' });
      if (!existing) {
        const name = process.env.SEED_NAME || 'Root Admin';
        const email = (process.env.SEED_EMAIL || 'admin@example.com').trim().toLowerCase();
        const password = process.env.SEED_PASSWORD || 'ChangeMe123!';
        const userId = (process.env.SEED_USER_ID || 'SuperAdmin01').trim();
        this.assertPasswordFitsBcrypt(password);
        await this.userModel.create({
          name,
          email,
          userId,
          userIdKey: this.userIdKey(userId),
          password: await bcrypt.hash(password, this.passwordRounds()),
          role: 'superadmin',
          createdBy: null,
        });
        this.logger.warn(
          `Created ephemeral development superadmin ${email}; set MONGODB_URI for persistent data`,
        );
      }
    }

    await this.ensureUserIds();
  }

  private passwordRounds() {
    const configured = Number(process.env.BCRYPT_ROUNDS || 12);
    return Number.isInteger(configured) && configured >= 10 && configured <= 14
      ? configured
      : 12;
  }

  private assertPasswordFitsBcrypt(password: string) {
    if (Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('Password must not exceed 72 UTF-8 bytes');
    }
  }

  private normalizeTeamName(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private normalizeUserId(value: string) {
    return value.trim();
  }

  private userIdKey(value: string) {
    return this.normalizeUserId(value).toLocaleLowerCase();
  }

  private userIdPrefix(role: string) {
    if (role === 'superadmin') return 'SuperAdmin';
    if (role === 'admin') return 'Admin';
    return 'User';
  }

  async ensureUserIds() {
    const accounts = await this.userModel
      .find({
        $or: [
          { userId: { $exists: false } },
          { userId: '' },
          { userIdKey: { $exists: false } },
        ],
      })
      .select('+userIdKey')
      .sort({ createdAt: 1 });

    for (const account of accounts) {
      let userId = account.userId?.trim();
      let key = userId ? this.userIdKey(userId) : '';
      const duplicate = key
        ? await this.userModel.exists({ _id: { $ne: account._id }, userIdKey: key })
        : true;

      if (!userId || duplicate) {
        const prefix = this.userIdPrefix(account.role);
        let sequence = 1;
        do {
          userId = `${prefix}${String(sequence).padStart(2, '0')}`;
          key = this.userIdKey(userId);
          sequence += 1;
        } while (await this.userModel.exists({ userIdKey: key }));
      }

      await this.userModel.updateOne(
        { _id: account._id },
        { $set: { userId, userIdKey: key } },
      );
    }
  }

  private teamNameKey(value: string) {
    return this.normalizeTeamName(value).toLocaleLowerCase();
  }

  private exactTeamName(value: string) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { $regex: `^${escaped}$`, $options: 'i' };
  }

  private async historicalTeamNameExists(teamName: string, exceptAdminId?: string) {
    return this.userModel.db.collection('entries').findOne({
      teamName: this.exactTeamName(teamName),
      ...(exceptAdminId ? { teamAdminId: { $ne: new Types.ObjectId(exceptAdminId) } } : {}),
    });
  }

  async ensureTeamNames() {
    // Existing admins predate named teams. Give each one a deterministic unique
    // name so new reports are never left unassigned after deployment.
    const admins = await this.userModel
      .find({
        role: 'admin',
        $or: [
          { teamName: { $exists: false } },
          { teamName: '' },
          { teamNameKey: { $exists: false } },
        ],
      })
      .sort({ createdAt: 1 });
    for (const admin of admins) {
      const base = admin.teamName
        ? this.normalizeTeamName(admin.teamName)
        : this.normalizeTeamName(`${admin.name} Team`);
      let candidate = base;
      let suffix = 2;
      while (await this.userModel.exists({
        _id: { $ne: admin._id },
        teamNameKey: this.teamNameKey(candidate),
      }) || await this.historicalTeamNameExists(candidate, admin.id)) {
        candidate = `${base} ${suffix}`;
        suffix += 1;
      }
      admin.teamName = candidate;
      admin.teamNameKey = this.teamNameKey(candidate);
      await admin.save();
    }
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email: email.trim().toLowerCase() });
  }

  async findByLoginIdentifier(identifier: string) {
    const value = identifier.trim();
    const email = value.toLowerCase();
    return this.userModel.findOne({
      $or: [
        { email },
        { userIdKey: this.userIdKey(value) },
      ],
    });
  }

  async findAll() {
    return this.userModel.find().select('-password').sort({ createdAt: -1 }).lean();
  }

  // Ids of the 'user' accounts assigned to a given admin — used to scope an
  // admin's report view to their own team instead of every account.
  async findTeamMemberIds(adminId: string): Promise<string[]> {
    const users = await this.userModel.find({ assignedAdminId: adminId }).select('_id').lean();
    return users.map((user) => String(user._id));
  }

  async getReportContext(accountId: string) {
    const owner = await this.userModel.findById(accountId).select('-password');
    if (!owner) throw new NotFoundException('Account not found');

    if (owner.role === 'admin') {
      if (!owner.teamName) throw new ConflictException('This admin does not have a team name');
      return {
        ownerAccountId: owner.id,
        ownerName: owner.name,
        ownerRole: owner.role,
        teamAdminId: owner.id,
        teamName: owner.teamName,
      };
    }

    if (owner.role === 'user') {
      const admin = owner.assignedAdminId
        ? await this.userModel.findOne({ _id: owner.assignedAdminId, role: 'admin' }).select('-password')
        : null;
      if (!admin) throw new ConflictException('This user is not assigned to an admin team');
      if (!admin.teamName) throw new ConflictException('The assigned admin does not have a team name');
      return {
        ownerAccountId: owner.id,
        ownerName: owner.name,
        ownerRole: owner.role,
        teamAdminId: admin.id,
        teamName: admin.teamName,
      };
    }

    throw new ConflictException('Superadmin accounts do not have personal production reports');
  }

  async getLegacyReportContext(entryName: string, creatorId?: string) {
    const resolve = async (accountId: string) => {
      try {
        return await this.getReportContext(accountId);
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) return null;
        throw error;
      }
    };
    const escaped = entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameMatches = await this.userModel
      .find({
        role: { $in: ['admin', 'user'] },
        name: { $regex: `^${escaped}$`, $options: 'i' },
      })
      .select('_id')
      .limit(2);

    if (nameMatches.length === 1) {
      return resolve(nameMatches[0].id);
    }

    if (creatorId) {
      const creator = await this.userModel
        .findOne({ _id: creatorId, role: { $in: ['admin', 'user'] } })
        .select('_id');
      if (creator) return resolve(creator.id);
    }

    return null;
  }

  async create(dto: CreateUserDto, creatorId: string) {
    this.assertPasswordFitsBcrypt(dto.password);
    const normalizedEmail = dto.email.trim().toLowerCase();
    const userId = this.normalizeUserId(dto.userId);
    const userIdKey = this.userIdKey(userId);
    const existing = await this.findByEmail(normalizedEmail);
    if (existing) throw new ConflictException('Email already in use');
    if (await this.userModel.exists({ userIdKey })) {
      throw new ConflictException('User ID already in use');
    }

    let assignedAdminId: string | null = null;
    let teamName: string | undefined;
    let teamNameKey: string | undefined;
    if (dto.role === 'user') {
      const admin = await this.userModel.findOne({
        _id: dto.assignedAdminId,
        role: 'admin',
        isActive: { $ne: false },
      });
      if (!admin) throw new NotFoundException('Selected admin not found');
      if (!admin.teamName) throw new ConflictException('Selected admin does not have a team name');
      assignedAdminId = admin.id;
    } else if (dto.role === 'admin') {
      teamName = this.normalizeTeamName(dto.teamName || '');
      if (!teamName) throw new ConflictException('Team name is required for admin accounts');
      teamNameKey = this.teamNameKey(teamName);
      const existingTeam = await this.userModel.exists({ teamNameKey });
      const historicalTeam = await this.historicalTeamNameExists(teamName);
      if (existingTeam || historicalTeam) throw new ConflictException('Team name already in use');
    }

    const hashed = await bcrypt.hash(dto.password, this.passwordRounds());

    const created = new this.userModel({
      name: dto.name.trim(),
      email: normalizedEmail,
      userId,
      userIdKey,
      password: hashed,
      role: dto.role,
      createdBy: creatorId,
      assignedAdminId,
      teamName,
      teamNameKey,
    });

    try {
      const saved = await created.save();
      const { password, teamNameKey: _teamNameKey, userIdKey: _userIdKey, ...safe } = saved.toObject();
      return safe;
    } catch (error: any) {
      if (error?.code === 11000 && error?.keyPattern?.email) {
        throw new ConflictException('Email already in use');
      }
      if (error?.code === 11000 && error?.keyPattern?.userIdKey) {
        throw new ConflictException('User ID already in use');
      }
      if (error?.code === 11000 && error?.keyPattern?.teamNameKey) {
        throw new ConflictException('Team name already in use');
      }
      throw error;
    }
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id).select('-password');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByIdForMfa(id: string) {
    const user = await this.userModel
      .findById(id)
      .select('-password +mfaSecretEncrypted +mfaRecoveryCodeHashes +mfaLastUsedStep');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async beginMfaSetup(id: string, encryptedSecret: string) {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      {
        $set: { mfaEnabled: false, mfaSecretEncrypted: encryptedSecret },
        $unset: {
          mfaRecoveryCodeHashes: 1,
          mfaLastUsedStep: 1,
          mfaSetupAt: 1,
        },
      },
      { new: true },
    ).select('-password');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async enableMfa(id: string, recoveryCodeHashes: string[], totpStep: number) {
    const user = await this.userModel.findOneAndUpdate(
      { _id: id, mfaEnabled: { $ne: true } },
      {
        $set: {
          mfaEnabled: true,
          mfaRecoveryCodeHashes: recoveryCodeHashes,
          mfaLastUsedStep: totpStep,
          mfaSetupAt: new Date(),
        },
      },
      { new: true },
    ).select('-password');
    if (!user) throw new ConflictException('Authenticator setup has already changed. Sign in again.');
    return user;
  }

  async recordMfaTotpUse(id: string, totpStep: number) {
    const user = await this.userModel.findOneAndUpdate(
      {
        _id: id,
        mfaEnabled: true,
        $or: [
          { mfaLastUsedStep: { $exists: false } },
          { mfaLastUsedStep: { $lt: totpStep } },
        ],
      },
      { $set: { mfaLastUsedStep: totpStep } },
      { new: true },
    ).select('-password');
    if (!user) {
      throw new UnauthorizedException('This authenticator code was already used. Wait for a new code.');
    }
    return user;
  }

  async consumeMfaRecoveryCode(id: string, recoveryCodeHash: string) {
    const user = await this.userModel.findOneAndUpdate(
      { _id: id, mfaEnabled: true, mfaRecoveryCodeHashes: recoveryCodeHash },
      { $pull: { mfaRecoveryCodeHashes: recoveryCodeHash } },
      { new: true },
    ).select('-password');
    if (!user) throw new UnauthorizedException('Invalid or already used recovery code');
    return user;
  }

  async resetMfa(id: string, actorId: string) {
    if (id === actorId) {
      throw new ConflictException('You cannot reset your own authenticator from account management');
    }
    const user = await this.userModel.findByIdAndUpdate(
      id,
      {
        $set: { mfaEnabled: false },
        $unset: {
          mfaSecretEncrypted: 1,
          mfaRecoveryCodeHashes: 1,
          mfaLastUsedStep: 1,
          mfaSetupAt: 1,
        },
      },
      { new: true },
    ).select('-password');
    if (!user) throw new NotFoundException('User not found');
    return { message: 'Authenticator reset. The account must enroll again at next sign-in.' };
  }

  async getOwnMfaSettings(id: string) {
    const user = await this.userModel.findOne({ _id: id, role: 'superadmin' })
      .select('mfaRequired');
    if (!user) throw new NotFoundException('Super Admin account not found');
    return { enabled: user.mfaRequired !== false };
  }

  async updateOwnMfaSettings(id: string, enabled: boolean) {
    const user = await this.userModel.findOneAndUpdate(
      { _id: id, role: 'superadmin' },
      {
        $set: {
          mfaRequired: enabled,
          mfaEnabled: false,
        },
        // Toggling either way invalidates only this Super Admin's previous
        // authenticator. Enabling therefore guarantees a fresh QR next login.
        $unset: {
          mfaSecretEncrypted: 1,
          mfaRecoveryCodeHashes: 1,
          mfaLastUsedStep: 1,
          mfaSetupAt: 1,
        },
      },
      { new: true },
    ).select('-password');
    if (!user) throw new NotFoundException('Super Admin account not found');
    return {
      enabled: user.mfaRequired !== false,
      newEnrollmentRequired: enabled,
    };
  }

  async updateProfile(id: string, dto: { name?: string; email?: string; message?: string; teamName?: string }) {
    const user = await this.userModel.findById(id).select('+teamNameKey');
    if (!user) throw new NotFoundException('User not found');

    if (dto.email) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const existing = await this.findByEmail(normalizedEmail);
        if (existing) throw new ConflictException('Email already in use');
        user.email = normalizedEmail;
      }
    }
    if (dto.name) user.name = dto.name.trim();
    if (dto.message !== undefined) user.message = dto.message.trim();
    let teamNameToSync: string | null = null;
    if (dto.teamName !== undefined) {
      if (user.role !== 'admin') {
        throw new ConflictException('Only admin accounts can have a team name');
      }
      const normalizedTeamName = this.normalizeTeamName(dto.teamName);
      if (!normalizedTeamName) throw new ConflictException('Team name is required');
      teamNameToSync = normalizedTeamName;
      const normalizedKey = this.teamNameKey(normalizedTeamName);
      if (normalizedKey !== user.teamNameKey) {
        const existingTeam = await this.userModel.exists({
          _id: { $ne: user._id },
          teamNameKey: normalizedKey,
        });
        const historicalTeam = await this.historicalTeamNameExists(normalizedTeamName, user.id);
        if (existingTeam || historicalTeam) throw new ConflictException('Team name already in use');
      }
      user.teamName = normalizedTeamName;
      user.teamNameKey = normalizedKey;
    }

    try {
      await user.save();
    } catch (error: any) {
      if (error?.code === 11000 && error?.keyPattern?.email) {
        throw new ConflictException('Email already in use');
      }
      if (error?.code === 11000 && error?.keyPattern?.teamNameKey) {
        throw new ConflictException('Team name already in use');
      }
      throw error;
    }
    if (teamNameToSync) {
      await this.userModel.db.collection('entries').updateMany(
        { teamAdminId: user._id },
        { $set: { teamName: teamNameToSync } },
      );
    }
    if (dto.name) {
      await this.userModel.db.collection('entries').updateMany(
        { ownerAccountId: user._id },
        { $set: { name: user.name } },
      );
    }
    const { password, teamNameKey: _teamNameKey, ...safe } = user.toObject();
    return safe;
  }

  async changeOwnPassword(id: string, currentPassword: string, newPassword: string) {
    this.assertPasswordFitsBcrypt(newPassword);
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) throw new UnauthorizedException('Current password is incorrect');
    user.password = await bcrypt.hash(newPassword, this.passwordRounds());
    await user.save();
    return { message: 'Password updated' };
  }

  async resetPassword(id: string, newPassword: string) {
    this.assertPasswordFitsBcrypt(newPassword);
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    user.password = await bcrypt.hash(newPassword, this.passwordRounds());
    await user.save();
    return { message: 'Password updated' };
  }

  async setActive(id: string, isActive: boolean, actorId: string) {
    if (id === actorId) {
      throw new ConflictException('You cannot change the status of your own account');
    }
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    user.isActive = isActive;
    await user.save();
    const { password, ...safe } = user.toObject();
    return safe;
  }

  async remove(id: string, actorId: string) {
    if (id === actorId) {
      throw new ConflictException('You cannot remove your own account');
    }
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'superadmin') {
      const superadminCount = await this.userModel.countDocuments({ role: 'superadmin' });
      if (superadminCount <= 1) {
        throw new ConflictException('The last superadmin account cannot be removed');
      }
    }
    if (user.role === 'admin') {
      const [assignedUsers, teamReports, assignedRecords] = await Promise.all([
        this.userModel.exists({ assignedAdminId: user._id }),
        this.userModel.db.collection('entries').findOne({ teamAdminId: user._id }),
        this.userModel.db.collection('recordentries').findOne({ adminIds: user._id }),
      ]);
      if (assignedUsers || teamReports || assignedRecords) {
        throw new ConflictException(
          'Reassign this admin’s users and remove their reports/records before deleting the account',
        );
      }
    }
    if (user.role === 'user') {
      const assignedRecord = await this.userModel.db
        .collection('recordentries')
        .findOne({ 'fields.userId': user._id });
      if (assignedRecord) {
        throw new ConflictException('Remove this user from assigned records before deleting the account');
      }
    }

    await user.deleteOne();
    return { message: 'Account removed' };
  }
}
