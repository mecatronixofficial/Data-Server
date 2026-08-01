import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  private normalizeTeamName(value: string) {
    return value.trim().replace(/\s+/g, ' ');
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

  async onModuleInit() {
    await this.ensureTeamNames();
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

  async findAll() {
    return this.userModel.find().select('-password').sort({ createdAt: -1 });
  }

  // Ids of the 'user' accounts assigned to a given admin — used to scope an
  // admin's report view to their own team instead of every account.
  async findTeamMemberIds(adminId: string): Promise<string[]> {
    const users = await this.userModel.find({ assignedAdminId: adminId }).select('_id');
    return users.map((user) => user.id);
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
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.findByEmail(normalizedEmail);
    if (existing) throw new ConflictException('Email already in use');

    let assignedAdminId: string | null = null;
    let teamName: string | undefined;
    let teamNameKey: string | undefined;
    if (dto.role === 'user') {
      const admin = await this.userModel.findOne({ _id: dto.assignedAdminId, role: 'admin' });
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

    const hashed = await bcrypt.hash(dto.password, 10);

    const created = new this.userModel({
      name: dto.name,
      email: normalizedEmail,
      password: hashed,
      role: dto.role,
      createdBy: creatorId,
      assignedAdminId,
      teamName,
      teamNameKey,
    });

    try {
      const saved = await created.save();
      const { password, teamNameKey: _teamNameKey, ...safe } = saved.toObject();
      return safe;
    } catch (error: any) {
      if (error?.code === 11000 && error?.keyPattern?.email) {
        throw new ConflictException('Email already in use');
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

  async updateProfile(id: string, dto: { name?: string; email?: string; teamName?: string }) {
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
        user.teamName = normalizedTeamName;
        user.teamNameKey = normalizedKey;
      }
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
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) throw new UnauthorizedException('Current password is incorrect');
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return { message: 'Password updated' };
  }

  async resetPassword(id: string, newPassword: string) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    return { message: 'Password updated' };
  }

  async setActive(id: string, isActive: boolean) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    user.isActive = isActive;
    await user.save();
    const { password, ...safe } = user.toObject();
    return safe;
  }

  async remove(id: string) {
    const deleted = await this.userModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('User not found');
    return { message: 'Account removed' };
  }
}
