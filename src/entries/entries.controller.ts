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
    return this.entriesService.create(dto, req.user);
  }

  @RequirePermissions('canCreateEntries')
  @Get('me')
  findMine(@Req() req: any) {
    return this.entriesService.findMine(req.user);
  }

  @RequirePermissions('viewAllReports')
  @Get()
  findAll(@Query() query: { name?: string; startDate?: string; endDate?: string }, @Req() req: any) {
    return this.entriesService.findAll(query, req.user);
  }

  @RequirePermissions('viewAllReports')
  @Get('export')
  async export(
    @Query() query: { name?: string; startDate?: string; endDate?: string },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const buffer = await this.entriesService.exportToExcel(query, req.user);
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
    @Req() req: any,
    @Res() res: Response,
  ) {
    const buffer = await this.entriesService.exportToPdf(query, req.user);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="entries-report.pdf"',
    });
    res.send(buffer);
  }

  @RequirePermissions('viewAllReports')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.entriesService.findOne(id, req.user);
  }

  // No @RequirePermissions here: admins/superadmins update via manageReports,
  // but a regular user must also be able to update their own single entry
  // (they only have canCreateEntries) — entriesService.update enforces both.
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CreateEntryDto, @Req() req: any) {
    return this.entriesService.update(id, dto, req.user);
  }

  @RequirePermissions('manageReports')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.entriesService.remove(id);
  }
}
