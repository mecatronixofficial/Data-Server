import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ReportSettingsDocument = ReportSettings & Document;

// Singleton document (one row in the collection) holding which Reports table
// columns are visible. null = show every column (default until a superadmin customizes it).
@Schema({ timestamps: true })
export class ReportSettings {
  @Prop({ type: [String], default: null })
  visibleColumns: string[] | null;
}

export const ReportSettingsSchema = SchemaFactory.createForClass(ReportSettings);
