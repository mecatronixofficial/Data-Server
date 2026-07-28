import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RecordEntryDocument = RecordEntry & Document;

// One field this record covers, paired with the single 'user'-role account that does
// data entry for it. Different fields in the same record can point to different users.
export class RecordFieldAssignment {
  @Prop({ type: Types.ObjectId, ref: 'Field', required: true })
  fieldId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
}

// Named RecordEntry (not Record) to avoid shadowing TypeScript's built-in Record<K, V> utility type.
@Schema({ timestamps: true })
export class RecordEntry {
  @Prop({ required: true, trim: true })
  name: string;

  // The field(s) this record is assigned to, each paired with the user who enters that
  // field's data (see FieldsModule). A record can cover one, several, or every field.
  @Prop({
    type: [{ fieldId: { type: Types.ObjectId, ref: 'Field' }, userId: { type: Types.ObjectId, ref: 'User' } }],
    required: true,
  })
  fields: RecordFieldAssignment[];

  // The admin account(s) this record is assigned to. Same one/several/every-admin
  // shape as before, validated against User documents with role 'admin'. Saving a record
  // grants the admin(s) and each field's user visibility on that field, and flips its
  // userOnlyEdit on so the admin can see but not edit it (see RecordsService.applyFieldAccess).
  @Prop({ type: [Types.ObjectId], ref: 'User', required: true })
  adminIds: Types.ObjectId[];
}

export const RecordEntrySchema = SchemaFactory.createForClass(RecordEntry);
