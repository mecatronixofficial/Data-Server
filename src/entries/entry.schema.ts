import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

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

// One value that changed on an update, e.g. name/date or a single field box.
@Schema({ _id: false })
export class EntryChange {
  @Prop({ required: true })
  label: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  from: string | number | null;

  @Prop({ type: MongooseSchema.Types.Mixed })
  to: string | number | null;
}

export const EntryChangeSchema = SchemaFactory.createForClass(EntryChange);

// One saved snapshot of "who changed what, when" — a new item is pushed each time
// update() actually changes a value, capped at the 5 most recent (see entries.service).
@Schema({ _id: false })
export class EntryHistoryItem {
  @Prop({ required: true, default: Date.now })
  updatedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  updatedBy: Types.ObjectId;

  @Prop({ type: [EntryChangeSchema], default: [] })
  changes: EntryChange[];
}

export const EntryHistoryItemSchema = SchemaFactory.createForClass(EntryHistoryItem);

@Schema({ timestamps: true, optimisticConcurrency: true })
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

  // Kept for compatibility with older data. New reports are scoped per team
  // through teamAdminId rather than sharing one global active document.
  @Prop({ default: false })
  isActive: boolean;

  // Older records may not have creator metadata. Keep that history unknown rather
  // than assigning it to whichever collaborator happens to save the record next.
  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  // Kept for compatibility with account-based reports. Team reports store the
  // team's admin id here; authorization uses teamAdminId below.
  @Prop({ type: Types.ObjectId, ref: 'User' })
  ownerAccountId?: Types.ObjectId;

  @Prop({ enum: ['user', 'admin'] })
  ownerRole?: 'user' | 'admin';

  // The admin team this report belongs to. This is the canonical report identity:
  // the admin and every assigned user read and update the same document.
  @Prop({ type: Types.ObjectId, ref: 'User' })
  teamAdminId?: Types.ObjectId;

  @Prop({ trim: true })
  teamName?: string;

  // Set on update() only — absent for entries that have never been edited.
  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;

  // Most recent edits first, capped at 5 (see entries.service#update).
  @Prop({ type: [EntryHistoryItemSchema], default: [] })
  history: EntryHistoryItem[];
}

export const EntrySchema = SchemaFactory.createForClass(Entry);
// The unique team index is created by EntriesService after legacy per-account
// documents have been consolidated. Declaring it here would make Mongoose race
// that startup migration when an existing database still contains duplicates.
EntrySchema.index({ teamAdminId: 1, updatedAt: -1 });
EntrySchema.index({ teamName: 1, ownerRole: 1 });
EntrySchema.index({ updatedAt: -1 });
