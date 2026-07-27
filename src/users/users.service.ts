import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

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

  async create(dto: CreateUserDto, creatorId: string) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.findByEmail(normalizedEmail);
    if (existing) throw new ConflictException('Email already in use');

    let assignedAdminId: string | null = null;
    if (dto.role === 'user') {
      const admin = await this.userModel.findOne({ _id: dto.assignedAdminId, role: 'admin' });
      if (!admin) throw new NotFoundException('Selected admin not found');
      assignedAdminId = admin.id;
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const created = new this.userModel({
      name: dto.name,
      email: normalizedEmail,
      password: hashed,
      role: dto.role,
      createdBy: creatorId,
      assignedAdminId,
    });

    try {
      const saved = await created.save();
      const { password, ...safe } = saved.toObject();
      return safe;
    } catch (error: any) {
      if (error?.code === 11000 && error?.keyPattern?.email) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id).select('-password');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(id: string, dto: { name?: string; email?: string }) {
    const user = await this.userModel.findById(id);
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

    try {
      await user.save();
    } catch (error: any) {
      if (error?.code === 11000 && error?.keyPattern?.email) {
        throw new ConflictException('Email already in use');
      }
      throw error;
    }
    const { password, ...safe } = user.toObject();
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
