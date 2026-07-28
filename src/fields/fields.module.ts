import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Field, FieldSchema } from './field.schema';
import { FinalTotalSettings, FinalTotalSettingsSchema } from './final-total-settings.schema';
import { FieldsService } from './fields.service';
import { FieldsController } from './fields.controller';
import { JwtSharedModule } from '../auth/jwt-shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Field.name, schema: FieldSchema },
      { name: FinalTotalSettings.name, schema: FinalTotalSettingsSchema },
    ]),
    JwtSharedModule,
  ],
  providers: [FieldsService],
  controllers: [FieldsController],
  exports: [FieldsService],
})
export class FieldsModule {}
