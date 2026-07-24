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

  // How this field's box values combine into its total:
  // 'grouped' = boxes split into two groups combined with an operator (like the original Field 1).
  // 'signed'  = plain sum, shown as separate positive/negative totals (like the original Field 2).
  @Prop({ required: true, enum: ['grouped', 'signed'], default: 'signed' })
  calcType: 'grouped' | 'signed';

  // Only meaningful when calcType is 'grouped': boxes[0..groupSplit-1] are group A, the rest are group B.
  @Prop({ default: 0 })
  groupSplit: number;
}

export const FieldSchema = SchemaFactory.createForClass(Field);
