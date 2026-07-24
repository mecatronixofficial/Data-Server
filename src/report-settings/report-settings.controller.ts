import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { ReportSettingsService } from './report-settings.service';
import { UpdateReportSettingsDto } from './dto/update-report-settings.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('report-settings')
export class ReportSettingsController {
  constructor(private reportSettingsService: ReportSettingsService) {}

  @RequirePermissions('viewAllReports')
  @Get()
  getSettings() {
    return this.reportSettingsService.getSettings();
  }

  @RequirePermissions('manageReportSettings')
  @Put()
  updateSettings(@Body() dto: UpdateReportSettingsDto) {
    return this.reportSettingsService.updateSettings(dto.visibleColumns);
  }
}
