import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { EntriesService } from './entries.service';
import { CreateEntryDto } from './dto/create-entry.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('entries')
export class EntriesController {
  constructor(private entriesService: EntriesService) {}

  @RequirePermissions('canCreateEntries')
  @Post()
  create(@Body() dto: CreateEntryDto, @Req() req: any) {
    return this.entriesService.create(dto, req.user.sub, req.user.role, req.user.permissions);
  }

  @RequirePermissions('canCreateEntries')
  @Get('me')
  findMine(@Req() req: any) {
    return this.entriesService.findMine(req.user.sub);
  }

  @RequirePermissions('viewAllReports')
  @Get()
  findAll(@Query() query: { name?: string; startDate?: string; endDate?: string }) {
    return this.entriesService.findAll(query);
  }

  @RequirePermissions('viewAllReports')
  @Get('export')
  async export(
    @Query() query: { name?: string; startDate?: string; endDate?: string },
    @Res() res: Response,
  ) {
    const buffer = await this.entriesService.exportToExcel(query);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="entries-report.xlsx"',
    });
    res.send(buffer);
  }

  @RequirePermissions('viewAllReports')
  @Get('export/pdf')
  async exportPdf(
    @Query() query: { name?: string; startDate?: string; endDate?: string },
    @Res() res: Response,
  ) {
    const buffer = await this.entriesService.exportToPdf(query);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="entries-report.pdf"',
    });
    res.send(buffer);
  }

  @RequirePermissions('viewAllReports')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.entriesService.findOne(id);
  }

  @RequirePermissions('manageReports')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateEntryDto, @Req() req: any) {
    return this.entriesService.update(id, dto, req.user.role, req.user.permissions);
  }

  @RequirePermissions('manageReports')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.entriesService.remove(id);
  }
}
