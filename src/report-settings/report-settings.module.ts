import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportSettings, ReportSettingsSchema } from './report-settings.schema';
import { ReportSettingsService } from './report-settings.service';
import { ReportSettingsController } from './report-settings.controller';
import { JwtSharedModule } from '../auth/jwt-shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ReportSettings.name, schema: ReportSettingsSchema }]),
    JwtSharedModule,
  ],
  providers: [ReportSettingsService],
  controllers: [ReportSettingsController],
  exports: [ReportSettingsService],
})
export class ReportSettingsModule {}
