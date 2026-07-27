import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EntryDocument = Entry & Document;

@Schema({ _id: false })
export class EntryField {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: [String], required: true })
  boxNames: string[];

  // Snapshot of each box's inner-field column config at the time this entry was saved
  // (see Field.boxFields) — kept alongside boxNames so edits later to the live Field
  // don't change how an already-saved entry's detail rows are labeled/rendered.
  @Prop({ type: [[Object]], default: [] })
  boxFields: Array<Array<{ label: string; type: string; auto?: string; sumTotal?: boolean }>>;

  @Prop({ type: [Number], required: true })
  boxes: number[];

  // Per-box breakdown rows. Each row is a bag of values keyed by that box's inner-field
  // labels (see Field.boxFields) at the time the entry was filled in.
  @Prop({ type: [[Object]], default: [] })
  details: Array<Array<Record<string, string | number>>>;

  // Snapshot of the field's calculation role at the time this entry was saved.
  @Prop({ required: true, enum: ['grouped', 'signed'], default: 'signed' })
  calcType: 'grouped' | 'signed';

  // 'grouped' only: boxes[0..groupSplit-1] are group A, the rest are group B.
  @Prop({ default: 0 })
  groupSplit: number;

  // 'grouped' only: operator combining groupATotal and groupBTotal, chosen by whoever filled the entry.
  @Prop({ required: true, enum: ['+', '-', '*', '/'], default: '+' })
  operator: string;

  // 'grouped' only.
  @Prop({ default: 0 })
  groupATotal: number;

  @Prop({ default: 0 })
  groupBTotal: number;

  // 'signed' only.
  @Prop({ default: 0 })
  positiveTotal: number;

  @Prop({ default: 0 })
  negativeTotal: number;

  @Prop({ required: true })
  total: number;
}

export const EntryFieldSchema = SchemaFactory.createForClass(EntryField);

@Schema({ timestamps: true })
export class Entry {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: [EntryFieldSchema], required: true })
  fields: EntryField[];

  // Operators combining consecutive field totals into finalTotal.
  // Length is fields.length - 1; empty/unused when there's a single field.
  @Prop({ type: [String], default: [] })
  fieldOperators: string[];

  @Prop({ required: true })
  finalTotal: number;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  // Set on update() only — absent for entries that have never been edited.
  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const EntrySchema = SchemaFactory.createForClass(Entry);
EntrySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
