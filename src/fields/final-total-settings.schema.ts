import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FinalTotalSettingsDocument = FinalTotalSettings & Document;

// Singleton document (one row in the collection) holding the superadmin-customizable
// label/icon/sign for the "Final Total" card shown on the entry page and Reports table.
@Schema({ timestamps: true })
export class FinalTotalSettings {
  @Prop({ default: 'Final Total', trim: true })
  label: string;

  @Prop({ default: '' })
  icon: string;

  // Whether the overall Final Total is shown/stored as a positive or negative value.
  // A single global toggle — not a per-field setting.
  @Prop({ enum: ['add', 'subtract'], default: 'add' })
  sign: 'add' | 'subtract';
}

export const FinalTotalSettingsSchema = SchemaFactory.createForClass(FinalTotalSettings);
