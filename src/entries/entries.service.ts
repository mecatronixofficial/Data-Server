import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as ExcelJS from 'exceljs';
import { Entry, EntryDocument } from './entry.schema';
import { CreateEntryDto } from './dto/create-entry.dto';

function applyOperator(a: number, b: number, op: string) {
  switch (op) {
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? 0 : a / b;
    default:
      return a + b;
  }
}

@Injectable()
export class EntriesService {
  constructor(@InjectModel(Entry.name) private entryModel: Model<EntryDocument>) {}

  // The backend always recomputes totals itself from raw boxes + operators.
  // Client-submitted totals (if any) are ignored entirely.
  private computeTotals(dto: CreateEntryDto) {
    const [b1, b2, b3, b4, b5, b6, b7, b8, b9, b10] = dto.field1Boxes;
    const total1 = b1 + b2 + b3 + b4 + b5 + b6 + b7;
    const total2 = b8 + b9 + b10;
    const field1Total = applyOperator(total1, total2, dto.operator1);

    // Field 2 groups all six values by sign, regardless of box position.
    const total3 = dto.field2Boxes
      .filter((value) => value > 0)
      .reduce((total, value) => total + value, 0);
    const total4 = dto.field2Boxes
      .filter((value) => value < 0)
      .reduce((total, value) => total + value, 0);
    const field2Total = total3 + total4;

    const finalTotal = applyOperator(field1Total, field2Total, dto.operator3);

    return { total1, total2, field1Total, total3, total4, field2Total, finalTotal };
  }

  async create(dto: CreateEntryDto, userId: string) {
    const normalizedName = dto.name.trim();
    const existing = await this.entryModel.findOne({
      name: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });
    if (existing) throw new ConflictException('An entry with this name already exists');

    const computed = this.computeTotals(dto);

    const created = new this.entryModel({
      name: normalizedName,
      date: new Date(dto.date),
      field1Boxes: dto.field1Boxes,
      field1BoxNames: dto.field1BoxNames.map((name, index) => name.trim() || `Box ${index + 1}`),
      operator1: dto.operator1,
      field2Boxes: dto.field2Boxes,
      field2BoxNames: dto.field2BoxNames.map((name, index) => name.trim() || `Box ${index + 1}`),
      operator2: '+',
      operator3: dto.operator3,
      ...computed,
      createdBy: new Types.ObjectId(userId),
    });

    try {
      return await created.save();
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('An entry with this name already exists');
      }
      throw error;
    }
  }

  async findMine(userId: string) {
    return this.entryModel.find({ createdBy: userId }).sort({ date: -1 });
  }

  private buildFilter(query: { name?: string; startDate?: string; endDate?: string }) {
    const filter: any = {};
    if (query.name) {
      filter.name = { $regex: query.name, $options: 'i' };
    }
    if (query.startDate || query.endDate) {
      filter.date = {};
      if (query.startDate) filter.date.$gte = new Date(query.startDate);
      if (query.endDate) filter.date.$lte = new Date(query.endDate);
    }
    return filter;
  }

  async findAll(query: { name?: string; startDate?: string; endDate?: string }) {
    const filter = this.buildFilter(query);
    return this.entryModel.find(filter).populate('createdBy', 'name email').sort({ date: -1 });
  }

  async findOne(id: string) {
    const entry = await this.entryModel.findById(id).populate('createdBy', 'name email');
    if (!entry) throw new NotFoundException('Entry not found');
    return entry;
  }

  async remove(id: string, requesterRole: string) {
    if (requesterRole === 'user') {
      throw new ForbiddenException('Users cannot delete entries');
    }
    const deleted = await this.entryModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Entry not found');
    return { message: 'Entry removed' };
  }

  async exportToExcel(query: { name?: string; startDate?: string; endDate?: string }) {
    const filter = this.buildFilter(query);
    const entries = await this.entryModel
      .find(filter)
      .populate('createdBy', 'name email')
      .sort({ date: -1 });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Entries');

    sheet.columns = [
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Field 1 Boxes', key: 'field1Boxes', width: 30 },
      { header: 'Field 1 Box Names', key: 'field1BoxNames', width: 50 },
      { header: 'Total 1', key: 'total1', width: 10 },
      { header: 'Total 2', key: 'total2', width: 10 },
      { header: 'Operator 1', key: 'operator1', width: 10 },
      { header: 'Field 1 Total', key: 'field1Total', width: 12 },
      { header: 'Field 2 Boxes', key: 'field2Boxes', width: 20 },
      { header: 'Field 2 Box Names', key: 'field2BoxNames', width: 50 },
      { header: 'Positive Total', key: 'total3', width: 14 },
      { header: 'Negative Total', key: 'total4', width: 14 },
      { header: 'Field 2 Total', key: 'field2Total', width: 12 },
      { header: 'Operator 3', key: 'operator3', width: 10 },
      { header: 'Final Total', key: 'finalTotal', width: 12 },
      { header: 'Created By', key: 'createdBy', width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const e of entries) {
      sheet.addRow({
        name: e.name,
        date: e.date.toISOString().split('T')[0],
        field1Boxes: e.field1Boxes.join(', '),
        field1BoxNames: e.field1BoxNames?.join(', ') || '',
        total1: e.total1,
        total2: e.total2,
        operator1: e.operator1,
        field1Total: e.field1Total,
        field2Boxes: e.field2Boxes.join(', '),
        field2BoxNames: e.field2BoxNames?.join(', ') || '',
        total3: e.total3,
        total4: e.total4,
        field2Total: e.field2Total,
        operator3: e.operator3,
        finalTotal: e.finalTotal,
        createdBy: (e.createdBy as any)?.name || '',
      });
    }

    return workbook.xlsx.writeBuffer();
  }
}
