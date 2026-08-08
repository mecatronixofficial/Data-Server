import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  // Human-readable login id. userIdKey enforces case-insensitive uniqueness.
  @Prop({ trim: true })
  userId?: string;

  @Prop({ select: false })
  userIdKey?: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true, enum: ['user', 'admin', 'superadmin'], default: 'user' })
  role: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedAdminId: Types.ObjectId | null;

  // Admin-only, human-readable identity for the team. teamNameKey is the
  // normalized value used to enforce case-insensitive uniqueness.
  @Prop({ trim: true })
  teamName?: string;

  @Prop({ select: false })
  teamNameKey?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  mfaEnabled: boolean;

  // MFA secrets and recovery-code hashes are never returned by ordinary user
  // queries. AuthService accesses them only through the dedicated service methods.
  @Prop({ select: false })
  mfaSecretEncrypted?: string;

  @Prop({ type: [String], select: false, default: undefined })
  mfaRecoveryCodeHashes?: string[];

  @Prop({ select: false })
  mfaLastUsedStep?: number;

  @Prop()
  mfaSetupAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index(
  { userIdKey: 1 },
  {
    unique: true,
    partialFilterExpression: { userIdKey: { $type: 'string' } },
  },
);
UserSchema.index({ assignedAdminId: 1, role: 1 });
UserSchema.index({ role: 1, isActive: 1, createdAt: -1 });
UserSchema.index(
  { teamNameKey: 1 },
  {
    unique: true,
    partialFilterExpression: { role: 'admin', teamNameKey: { $type: 'string' } },
  },
);
