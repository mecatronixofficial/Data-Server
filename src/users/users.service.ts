import { Injectable, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
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

  async create(dto: CreateUserDto, creatorRole: string, creatorId: string) {
    // Enforce hierarchy: superadmin -> admin/user, admin -> user only
    if (creatorRole === 'admin' && dto.role !== 'user') {
      throw new ForbiddenException('Admins may only create user accounts');
    }
    if (creatorRole === 'user') {
      throw new ForbiddenException('Users cannot create accounts');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.findByEmail(normalizedEmail);
    if (existing) throw new ConflictException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 10);

    const created = new this.userModel({
      name: dto.name,
      email: normalizedEmail,
      password: hashed,
      role: dto.role,
      createdBy: creatorId,
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

  async remove(id: string, requesterRole: string) {
    if (requesterRole !== 'superadmin') {
      throw new ForbiddenException('Only super admins can remove accounts');
    }
    const deleted = await this.userModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('User not found');
    return { message: 'User removed' };
  }
}
