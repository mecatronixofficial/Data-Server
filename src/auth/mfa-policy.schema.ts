import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MfaPolicyDocument = MfaPolicy & Document;

@Schema({ timestamps: true })
export class MfaPolicy {
  @Prop({ required: true, unique: true, default: 'global' })
  key: string;

  @Prop({ required: true, default: true })
  enabled: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const MfaPolicySchema = SchemaFactory.createForClass(MfaPolicy);
