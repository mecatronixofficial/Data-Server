import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as ExcelJS from 'exceljs';
import { Entry, EntryDocument, EntryField } from './entry.schema';
import { CreateEntryDto, EntryFieldInputDto } from './dto/create-entry.dto';
import { FieldsService } from '../fields/fields.service';
import { Field } from '../fields/field.schema';
import { PermissionKey } from '../common/permissions';

function sum(nums: number[]) {
  return nums.reduce((total, value) => total + value, 0);
}

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
  constructor(
    @InjectModel(Entry.name) private entryModel: Model<EntryDocument>,
    private fieldsService: FieldsService,
  ) {}

  // Field names/box counts always come from the live Field config (server-trusted),
  // never from client-submitted names, to stop a user from forging inaccessible fields.
  private async resolveFields(
    inputs: EntryFieldInputDto[],
    requesterRole: string,
    requesterPermissions: Record<PermissionKey, boolean>,
  ) {
    const canonical: Field[] = requesterPermissions?.manageReports
      ? await this.fieldsService.findAll()
      : await this.fieldsService.findForRole(requesterRole);
    const canonicalByName = new Map(canonical.map((field) => [field.name, field]));

    const fields: EntryField[] = inputs.map((input) => {
      const field = canonicalByName.get(input.name.trim());
      if (!field) {
        throw new ForbiddenException(`Field "${input.name}" is not available to your role`);
      }
      if (input.boxes.length !== field.boxNames.length) {
        throw new BadRequestException(`Field "${field.name}" expects ${field.boxNames.length} boxes`);
      }

      const base = {
        name: field.name,
        boxNames: field.boxNames,
        boxes: input.boxes,
        details: input.details || [],
        calcType: field.calcType,
        groupSplit: field.groupSplit,
      };

      if (field.calcType === 'grouped') {
        const operator = input.operator || '+';
        const groupATotal = sum(input.boxes.slice(0, field.groupSplit));
        const groupBTotal = sum(input.boxes.slice(field.groupSplit));
        return {
          ...base,
          operator,
          groupATotal,
          groupBTotal,
          positiveTotal: 0,
          negativeTotal: 0,
          total: applyOperator(groupATotal, groupBTotal, operator),
        };
      }

      const positiveTotal = input.boxes.filter((value) => value > 0).reduce((total, value) => total + value, 0);
      const negativeTotal = input.boxes.filter((value) => value < 0).reduce((total, value) => total + value, 0);
      return {
        ...base,
        operator: '+',
        groupATotal: 0,
        groupBTotal: 0,
        positiveTotal,
        negativeTotal,
        total: positiveTotal + negativeTotal,
      };
    });

    return fields;
  }

  private combineTotals(fields: EntryField[], fieldOperators: string[]) {
    if (fields.length === 0) return 0;
    if (fields.length === 1) return fields[0].total;
    if (fieldOperators.length !== fields.length - 1) {
      throw new BadRequestException('fieldOperators must have one entry between each pair of fields');
    }
    return fields.slice(1).reduce((acc, field, index) => applyOperator(acc, field.total, fieldOperators[index]), fields[0].total);
  }

  async create(
    dto: CreateEntryDto,
    userId: string,
    requesterRole: string,
    requesterPermissions: Record<PermissionKey, boolean>,
  ) {
    const normalizedName = dto.name.trim();
    const existing = await this.entryModel.findOne({
      name: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });
    if (existing) throw new ConflictException('An entry with this name already exists');

    const fields = await this.resolveFields(dto.fields, requesterRole, requesterPermissions);
    const finalTotal = this.combineTotals(fields, dto.fieldOperators);

    const created = new this.entryModel({
      name: normalizedName,
      date: new Date(dto.date),
      fields,
      fieldOperators: fields.length > 1 ? dto.fieldOperators : [],
      finalTotal,
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
    return this.entryModel.find(filter).populate('createdBy', 'name email').sort({ updatedAt: -1 });
  }

  async findOne(id: string) {
    const entry = await this.entryModel.findById(id).populate('createdBy', 'name email');
    if (!entry) throw new NotFoundException('Entry not found');
    return entry;
  }

  async update(
    id: string,
    dto: CreateEntryDto,
    requesterRole: string,
    requesterPermissions: Record<PermissionKey, boolean>,
  ) {
    const normalizedName = dto.name.trim();
    const duplicate = await this.entryModel.findOne({
      _id: { $ne: id },
      name: { $regex: `^${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });
    if (duplicate) throw new ConflictException('An entry with this name already exists');

    const entry = await this.entryModel.findById(id);
    if (!entry) throw new NotFoundException('Entry not found');

    const fields = await this.resolveFields(dto.fields, requesterRole, requesterPermissions);
    const finalTotal = this.combineTotals(fields, dto.fieldOperators);

    entry.set({
      name: normalizedName,
      date: new Date(dto.date),
      fields,
      fieldOperators: fields.length > 1 ? dto.fieldOperators : [],
      finalTotal,
    });

    try {
      return await entry.save();
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('An entry with this name already exists');
      }
      throw error;
    }
  }

  async remove(id: string) {
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

    const maxFields = entries.reduce((max, entry) => Math.max(max, entry.fields.length), 0);
    const columns: Partial<ExcelJS.Column>[] = [
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Date', key: 'date', width: 14 },
    ];
    for (let i = 0; i < maxFields; i += 1) {
      columns.push({ header: `Field ${i + 1} Name`, key: `field${i}Name`, width: 18 });
      columns.push({ header: `Field ${i + 1} Boxes`, key: `field${i}Boxes`, width: 30 });
      columns.push({ header: `Field ${i + 1} Breakdown`, key: `field${i}Breakdown`, width: 24 });
      columns.push({ header: `Field ${i + 1} Total`, key: `field${i}Total`, width: 12 });
    }
    columns.push({ header: 'Field Operators', key: 'fieldOperators', width: 16 });
    columns.push({ header: 'Final Total', key: 'finalTotal', width: 12 });
    columns.push({ header: 'Created By', key: 'createdBy', width: 20 });
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };

    for (const e of entries) {
      const row: Record<string, unknown> = {
        name: e.name,
        date: e.date.toISOString().split('T')[0],
        fieldOperators: e.fieldOperators.join(' '),
        finalTotal: e.finalTotal,
        createdBy: (e.createdBy as any)?.name || '',
      };
      e.fields.forEach((field, index) => {
        row[`field${index}Name`] = field.name;
        row[`field${index}Boxes`] = field.boxes.join(', ');
        row[`field${index}Breakdown`] = field.calcType === 'grouped'
          ? `A=${field.groupATotal} ${field.operator} B=${field.groupBTotal}`
          : `+${field.positiveTotal} + (${field.negativeTotal})`;
        row[`field${index}Total`] = field.total;
      });
      sheet.addRow(row);
    }

    return workbook.xlsx.writeBuffer();
  }

  async exportToPdf(query: { name?: string; startDate?: string; endDate?: string }) {
    const entries = await this.entryModel
      .find(this.buildFilter(query))
      .populate('createdBy', 'name email')
      .sort({ date: -1 });

    const escapePdf = (value: unknown) => String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[^\x20-\x7E]/g, '');
    // One detailed record per page keeps all box names and values readable.
    const pages = entries.length ? entries.map((entry) => [entry]) : [[]];
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];

    for (const [pageIndex, pageEntries] of pages.entries()) {
      const lines = [
        'BT',
        '/F1 18 Tf',
        `1 0 0 1 48 750 Tm (${escapePdf('Beone Production - Reports')}) Tj`,
        '/F1 9 Tf',
        `1 0 0 1 48 728 Tm (${escapePdf(`Record ${pageIndex + 1} of ${pages.length}`)}) Tj`,
        '/F1 8 Tf',
      ];
      const entry: any = pageEntries[0];
      if (!entry) {
        lines.push(`1 0 0 1 48 688 Tm (${escapePdf('No entries match these filters.')}) Tj`);
      } else {
        const addRow = (y: number, field: string, box: string, name: unknown, value: unknown) => {
          lines.push(`1 0 0 1 48 ${y} Tm (${escapePdf(field)}) Tj`);
          lines.push(`1 0 0 1 130 ${y} Tm (${escapePdf(box)}) Tj`);
          lines.push(`1 0 0 1 205 ${y} Tm (${escapePdf(name)}) Tj`);
          lines.push(`1 0 0 1 470 ${y} Tm (${escapePdf(value)}) Tj`);
        };
        lines.push(`1 0 0 1 48 700 Tm (${escapePdf(`Name: ${entry.name}`)}) Tj`);
        lines.push(`1 0 0 1 270 700 Tm (${escapePdf(`Date: ${entry.date.toISOString().split('T')[0]}`)}) Tj`);
        lines.push(`1 0 0 1 420 700 Tm (${escapePdf(`Added by: ${(entry.createdBy as any)?.name || ''}`)}) Tj`);
        lines.push(`1 0 0 1 48 680 Tm (${escapePdf('Field')}) Tj`);
        lines.push(`1 0 0 1 130 680 Tm (${escapePdf('Box')}) Tj`);
        lines.push(`1 0 0 1 205 680 Tm (${escapePdf('Name')}) Tj`);
        lines.push(`1 0 0 1 470 680 Tm (${escapePdf('Value')}) Tj`);
        let y = 662;
        entry.fields.forEach((field: any, fieldIndex: number) => {
          field.boxes.forEach((value: number, index: number) => {
            addRow(y, field.name, `Box ${index + 1}`, field.boxNames?.[index] || '', value);
            y -= 17;
          });
          if (field.calcType === 'grouped') {
            addRow(y, field.name, 'Subtotal', 'Group A', field.groupATotal);
            y -= 17;
            addRow(y, field.name, 'Subtotal', 'Group B', field.groupBTotal);
            y -= 17;
            addRow(y, field.name, 'Operator', 'Operator', field.operator);
            y -= 17;
          } else {
            addRow(y, field.name, 'Subtotal', 'Positive Total', field.positiveTotal);
            y -= 17;
            addRow(y, field.name, 'Subtotal', 'Negative Total', field.negativeTotal);
            y -= 17;
          }
          addRow(y, field.name, 'Total', `${field.name} Total`, field.total);
          y -= 17;
          if (fieldIndex < entry.fields.length - 1) {
            addRow(y, 'Final', 'Operator', 'Field Operator', entry.fieldOperators[fieldIndex] || '+');
            y -= 17;
          }
        });
        addRow(y, 'Final', 'Total', 'Final Total', entry.finalTotal);
      }
      lines.push('ET');
      const content = lines.join('\n');
      const pageObject = 4 + pageIndex * 2;
      const contentObject = pageObject + 1;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
      objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    }

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }
}
