import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { RecordsService } from './records.service';
import { UpsertRecordDto } from './dto/upsert-record.dto';

// Management routes are gated behind manageFields (superadmin only, same as /fields)
// since a record is always assigned to a field the superadmin manages. /mine has no
// such requirement — any authenticated admin/user can see their own assignments.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('records')
export class RecordsController {
  constructor(private recordsService: RecordsService) {}

  @RequirePermissions('manageFields')
  @Get()
  findAll() {
    return this.recordsService.findAll();
  }

  // An admin sees every record they supervise (all of its fields/users); a user sees
  // only the field(s) within a record that are assigned to them.
  @Get('mine')
  findMine(@Req() req: any) {
    return this.recordsService.findMine(req.user.sub, req.user.role);
  }

  @RequirePermissions('manageFields')
  @Post()
  create(@Body() dto: UpsertRecordDto) {
    return this.recordsService.create(dto);
  }

  @RequirePermissions('manageFields')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpsertRecordDto) {
    return this.recordsService.update(id, dto);
  }

  @RequirePermissions('manageFields')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.recordsService.remove(id);
  }
}
