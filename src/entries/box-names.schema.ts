import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BoxNamesDocument = BoxNames & Document;

@Schema({ timestamps: true })
export class BoxNames {
  @Prop({ required: true, unique: true, default: 'global' })
  key: string;

  @Prop({ type: [String], required: true })
  field1BoxNames: string[];

  @Prop({ type: [String], required: true })
  field2BoxNames: string[];
}

export const BoxNamesSchema = SchemaFactory.createForClass(BoxNames);
