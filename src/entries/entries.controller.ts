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
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { EntriesService } from './entries.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { UpdateBoxNamesDto } from './dto/update-box-names.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('entries')
export class EntriesController {
  constructor(private entriesService: EntriesService) {}

  @Post()
  create(@Body() dto: CreateEntryDto, @Req() req: any) {
    return this.entriesService.create(dto, req.user.sub);
  }

  @Get('box-names')
  getBoxNames() {
    return this.entriesService.getBoxNames();
  }

  @Put('box-names')
  @Roles('superadmin')
  updateBoxNames(@Body() dto: UpdateBoxNamesDto) {
    return this.entriesService.updateBoxNames(dto);
  }

  @Get('me')
  @Roles('admin', 'superadmin')
  findMine(@Req() req: any) {
    return this.entriesService.findMine(req.user.sub);
  }

  @Roles('admin', 'superadmin')
  @Get()
  findAll(@Query() query: { name?: string; startDate?: string; endDate?: string }) {
    return this.entriesService.findAll(query);
  }

  @Roles('admin', 'superadmin')
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

  @Get(':id')
  @Roles('admin', 'superadmin')
  findOne(@Param('id') id: string) {
    return this.entriesService.findOne(id);
  }

  @Put(':id')
  @Roles('superadmin')
  update(@Param('id') id: string, @Body() dto: CreateEntryDto) {
    return this.entriesService.update(id, dto);
  }

  @Roles('superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.entriesService.remove(id, req.user.role);
  }
}
