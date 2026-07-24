import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { FieldsService } from './fields.service';
import { UpsertFieldDto } from './dto/upsert-field.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('fields')
export class FieldsController {
  constructor(private fieldsService: FieldsService) {}

  @RequirePermissions('manageFields')
  @Get()
  findAll() {
    return this.fieldsService.findAll();
  }

  @Get('mine')
  findMine(@Req() req: any) {
    return this.fieldsService.findForRole(req.user.role);
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
