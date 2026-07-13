import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EntryDocument = Entry & Document;

@Schema({ timestamps: true })
export class Entry {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  date: Date;

  // Field 1: 10 boxes
  @Prop({ type: [Number], required: true })
  field1Boxes: number[];

  @Prop({ required: true })
  total1: number; // sum of boxes 1-7

  @Prop({ required: true })
  total2: number; // sum of boxes 8-10

  @Prop({ required: true, enum: ['+', '-', '*', '/'], default: '+' })
  operator1: string;

  @Prop({ required: true })
  field1Total: number;

  // Field 2: 6 boxes
  @Prop({ type: [Number], required: true })
  field2Boxes: number[];

  @Prop({ required: true })
  total3: number; // sum of all positive Field 2 values

  @Prop({ required: true })
  total4: number; // sum of all negative Field 2 values

  // Retained for compatibility with existing records; Field 2 always uses addition.
  @Prop({ required: true, enum: ['+', '-', '*', '/'], default: '+' })
  operator2: string;

  @Prop({ required: true })
  field2Total: number;

  // Field 3: combine field totals
  @Prop({ required: true, enum: ['+', '-', '*', '/'], default: '+' })
  operator3: string;

  @Prop({ required: true })
  finalTotal: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export const EntrySchema = SchemaFactory.createForClass(Entry);
EntrySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
