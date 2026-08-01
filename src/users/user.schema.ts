import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

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
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index(
  { teamNameKey: 1 },
  {
    unique: true,
    partialFilterExpression: { role: 'admin', teamNameKey: { $type: 'string' } },
  },
);
