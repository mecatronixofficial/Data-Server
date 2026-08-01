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

  // Color key per box, parallel to boxNames (see COLOR_KEYS in color-keys.ts). Empty string
  // means no override — the box falls back to the sign-based green/red/blue coloring.
  @Prop({ type: [String], default: [] })
  boxColors: string[];

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
    sumSign?: 'add' | 'subtract';
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

  // When true, only 'user'-role accounts may edit this field's box/detail values on an
  // entry — 'admin' accounts see the values but any edits they submit are ignored (see
  // EntriesService). When false, it's the reverse: only 'admin' may edit it, 'user' cannot.
  // Superadmin is never restricted by this. Lets one entry be jointly filled in by an
  // admin and the user assigned to them, each owning a different subset of fields.
  @Prop({ default: false })
  userOnlyEdit: boolean;
}

export const FieldSchema = SchemaFactory.createForClass(Field);
