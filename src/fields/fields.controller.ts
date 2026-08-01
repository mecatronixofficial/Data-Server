import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { FieldsService } from './fields.service';
import { UpsertFieldDto } from './dto/upsert-field.dto';
import { UpdateFinalTotalSettingsDto } from './dto/update-final-total-settings.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fields')
export class FieldsController {
  constructor(private fieldsService: FieldsService) {}

  @Get()
  findAll() {
    return this.fieldsService.findAll();
  }

  // Any authenticated account — the entry page and Reports table both show the
  // Final Total card/column using this superadmin-customizable label/icon.
  @Get('final-total-settings')
  getFinalTotalSettings() {
    return this.fieldsService.getFinalTotalSettings();
  }

  @RequirePermissions('manageFields')
  @Put('final-total-settings')
  updateFinalTotalSettings(@Body() dto: UpdateFinalTotalSettingsDto) {
    return this.fieldsService.updateFinalTotalSettings(dto);
  }

  // Any authenticated account can retrieve the edit assignment for every field.
  @Get('edit-locks')
  findEditLocks() {
    return this.fieldsService.findEditLocks();
  }

  @RequirePermissions('manageFields')
  @Post()
  create(@Body() dto: UpsertFieldDto) {
    return this.fieldsService.create(dto);
  }

  @RequirePermissions('manageFields')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpsertFieldDto) {
    return this.fieldsService.update(id, dto);
  }

  @RequirePermissions('manageFields')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fieldsService.remove(id);
  }
}
