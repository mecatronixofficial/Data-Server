import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FieldDocument = Field & Document;

@Schema({ timestamps: true })
export class Field {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ required: true, default: 0 })
  order: number;

  @Prop({ type: [String], required: true })
  boxNames: string[];

  // Icon key shown next to the field name (see ICON_KEYS in fields.service.ts).
  @Prop({ default: '' })
  icon: string;

  // Icon key per box, parallel to boxNames.
  @Prop({ type: [String], default: [] })
  boxIcons: string[];

  // Inner-field columns for each box's detail table, parallel to boxNames. Each box has
  // its own independent, fully editable list (defaults to Name/Value, see FieldsService).
  // 'auto' columns are filled in without the user typing them: row position, the logged-in
  // user's name, or a fixed value the superadmin sets ('constant'). 'sumTotal' marks which
  // number/computed column(s) roll up into the box total. 'computed' columns derive their
  // value from two other columns via 'formula' (see BoxFieldDef on the frontend).
  // Stored as untyped Object (like EntryField.boxFields below) rather than a fixed Mongoose
  // sub-schema shape, so adding a new column property here never requires a schema migration
  // and — critically — Mongoose never silently strips a property this shape doesn't know about.
  @Prop({ type: [[Object]], default: [] })
  boxFields: Array<Array<{
    label: string;
    type: 'text' | 'number' | 'date' | 'time' | 'computed';
    auto?: 'serial' | 'user' | 'constant';
    constant?: number;
    sumTotal?: boolean;
    formula?: { op: 'multiply' | 'percentAdd'; a: string; b: string };
  }>>;

  // How this field's box values combine into its total:
  // 'grouped' = boxes split into two groups combined with an operator (like the original Field 1).
  // 'signed'  = plain sum, shown as separate positive/negative totals (like the original Field 2).
  @Prop({ required: true, enum: ['grouped', 'signed'], default: 'signed' })
  calcType: 'grouped' | 'signed';

  // Only meaningful when calcType is 'grouped': boxes[0..groupSplit-1] are group A, the rest are group B.
  @Prop({ default: 0 })
  groupSplit: number;

  // Specific user/admin account ids allowed to see this field on the data-entry page.
  // Empty = hidden from every user/admin account. Superadmin always manages fields via
  // /fields regardless of this setting.
  @Prop({ type: [String], default: [] })
  visibleUserIds: string[];
}

export const FieldSchema = SchemaFactory.createForClass(Field);
