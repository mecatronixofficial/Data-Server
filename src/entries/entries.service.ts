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
import { UsersService } from '../users/users.service';

export type ReportActor = { sub: string; role: string };

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
    private usersService: UsersService,
  ) {}

  // An admin only sees their own entries plus those of the users assigned to
  // them — never other admins' entries or other admins' teams. Superadmins
  // are unrestricted.
  private async scopeFilterForActor(filter: any, actor?: ReportActor) {
    if (actor?.role === 'admin') {
      const teamIds = await this.usersService.findTeamMemberIds(actor.sub);
      filter.createdBy = { $in: [actor.sub, ...teamIds] };
    }
    return filter;
  }

  // Whether this actor is allowed to write this field's values, per Field.userOnlyEdit:
  // superadmin always can; admin can unless the field is locked to the user; user can
  // only on fields locked to them. Lets one entry be jointly filled by an admin and the
  // user assigned to them, each owning a different subset of fields.
  private canEditField(actorRole: string, field: Field) {
    if (actorRole === 'superadmin') return true;
    if (actorRole === 'admin') return !field.userOnlyEdit;
    if (actorRole === 'user') return Boolean(field.userOnlyEdit);
    return false;
  }

  // Field names/box counts always come from the live Field config (server-trusted),
  // never from client-submitted names. Values for a field this actor isn't allowed to
  // edit are never taken from the client — they keep their previous saved value
  // (update) or start blank (create), no matter what was submitted.
  private async resolveFields(
    inputs: EntryFieldInputDto[],
    actorRole: string,
    existingByName?: Map<string, EntryField>,
  ) {
    const canonical: Field[] = await this.fieldsService.findAll();
    const canonicalByName = new Map(canonical.map((field) => [field.name, field]));

    const fields: EntryField[] = inputs.map((input) => {
      const field = canonicalByName.get(input.name.trim());
      if (!field) {
        throw new ForbiddenException(`Field "${input.name}" does not exist`);
      }
      if (input.boxes.length !== field.boxNames.length) {
        throw new BadRequestException(`Field "${field.name}" expects ${field.boxNames.length} boxes`);
      }

      const allowed = this.canEditField(actorRole, field);
      const existing = existingByName?.get(field.name);
      const boxes = allowed ? input.boxes : existing ? [...existing.boxes] : input.boxes.map(() => 0);
      const details = allowed ? (input.details || []) : existing ? existing.details : input.boxes.map(() => []);
      const operatorInput = allowed ? input.operator : existing?.operator;

      const base = {
        name: field.name,
        boxNames: field.boxNames,
        boxFields: field.boxFields,
        boxes,
        details,
        calcType: field.calcType,
        groupSplit: field.groupSplit,
      };

      if (field.calcType === 'grouped') {
        const operator = operatorInput || '+';
        const groupATotal = sum(boxes.slice(0, field.groupSplit));
        const groupBTotal = sum(boxes.slice(field.groupSplit));
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

      const positiveTotal = boxes.filter((value) => value > 0).reduce((total, value) => total + value, 0);
      const negativeTotal = boxes.filter((value) => value < 0).reduce((total, value) => total + value, 0);
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

  // Plain sum of every field's total. The overall +/- sign applied on top of this
  // (see FinalTotalSettings.sign, a single superadmin-set global toggle — not a
  // per-field setting) is applied by the caller.
  private combineTotals(fields: EntryField[]) {
    const rawTotal = fields.reduce((total, field) => total + field.total, 0);
    const fieldOperators = fields.length > 1 ? Array(fields.length - 1).fill('+') : [];
    return { rawTotal, fieldOperators };
  }

  // Escapes a name for safe use inside a case-insensitive exact-match $regex.
  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private exactNameRegex(value: string) {
    return { $regex: `^${this.escapeRegex(value)}$`, $options: 'i' };
  }

  async create(dto: CreateEntryDto, actor: ReportActor) {
    const normalizedName = dto.name.trim();
    const existing = await this.entryModel.findOne({ name: this.exactNameRegex(normalizedName) });
    if (existing) throw new ConflictException('An entry with this name already exists');

    const fields = await this.resolveFields(dto.fields, actor.role);
    const { rawTotal, fieldOperators } = this.combineTotals(fields);
    const { sign } = await this.fieldsService.getFinalTotalSettings();
    const finalTotal = sign === 'subtract' ? -rawTotal : rawTotal;

    const created = new this.entryModel({
      name: normalizedName,
      date: new Date(dto.date),
      fields,
      fieldOperators: fields.length > 1 ? fieldOperators : [],
      finalTotal,
      createdBy: new Types.ObjectId(actor.sub),
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

  // "My entry" means the record for this person, not just rows they personally
  // saved: an admin may have created it on the user's behalf (createdBy = admin),
  // so match on the user's own account name too, not createdBy alone.
  async findMine(actor: { sub: string; name: string }) {
    return this.entryModel
      .find({
        $or: [{ createdBy: actor.sub }, { name: this.exactNameRegex(actor.name.trim()) }],
      })
      .sort({ date: -1 });
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

  async findAll(query: { name?: string; startDate?: string; endDate?: string }, actor?: ReportActor) {
    const filter = await this.scopeFilterForActor(this.buildFilter(query), actor);
    return this.entryModel
      .find(filter)
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role')
      .sort({ updatedAt: -1 });
  }

  async findOne(id: string, actor?: ReportActor) {
    const entry = await this.entryModel
      .findById(id)
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role')
      .populate('history.updatedBy', 'name email role');
    if (!entry) throw new NotFoundException('Entry not found');
    if (actor?.role === 'admin') {
      const teamIds = await this.usersService.findTeamMemberIds(actor.sub);
      const allowed = new Set([actor.sub, ...teamIds]);
      if (!allowed.has(String((entry.createdBy as any)?._id || entry.createdBy))) {
        throw new NotFoundException('Entry not found');
      }
    }
    return entry;
  }

  // Compares the currently-saved entry against the incoming payload and returns one
  // change record per value that actually differs (name, date, and per-box field values).
  private diffEntry(entry: EntryDocument, normalizedName: string, newDate: Date, fields: EntryField[]) {
    const changes: { label: string; from: string | number | null; to: string | number | null }[] = [];

    if (entry.name !== normalizedName) {
      changes.push({ label: 'Name', from: entry.name, to: normalizedName });
    }

    const oldDateStr = entry.date.toISOString().split('T')[0];
    const newDateStr = newDate.toISOString().split('T')[0];
    if (oldDateStr !== newDateStr) {
      changes.push({ label: 'Date', from: oldDateStr, to: newDateStr });
    }

    const oldFieldsByName = new Map(entry.fields.map((field) => [field.name, field]));
    for (const field of fields) {
      const oldField = oldFieldsByName.get(field.name);
      if (!oldField) continue;
      field.boxes.forEach((value, index) => {
        const oldValue = oldField.boxes[index] ?? 0;
        if (oldValue !== value) {
          const boxLabel = field.boxNames[index] || `Box ${index + 1}`;
          changes.push({ label: `${field.name} – ${boxLabel}`, from: oldValue, to: value });
        }
      });
    }

    return changes;
  }

  async update(
    id: string,
    dto: CreateEntryDto,
    actor: { sub: string; name: string; role: string; permissions?: Record<string, boolean> },
  ) {
    const entry = await this.entryModel.findById(id);
    if (!entry) throw new NotFoundException('Entry not found');

    // Admins/superadmins (manageReports) can edit any entry. A regular user
    // (canCreateEntries only) may edit their own entry — matched by createdBy
    // OR by name, since an admin may have originally created it on their
    // behalf (createdBy = admin, name = the user's own name).
    const isOwner = String(entry.createdBy) === actor.sub
      || entry.name.trim().toLowerCase() === actor.name.trim().toLowerCase();
    const canManageAny = Boolean(actor.permissions?.manageReports);
    const canUpdateOwn = Boolean(actor.permissions?.canCreateEntries) && isOwner;
    if (!canManageAny && !canUpdateOwn) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }

    // An admin (unlike superadmin) may only manage entries within their own team —
    // their own record or one of the users assigned to them (mirrors findOne/scopeFilterForActor).
    if (canManageAny && actor.role === 'admin') {
      const teamIds = await this.usersService.findTeamMemberIds(actor.sub);
      const allowed = new Set([actor.sub, ...teamIds]);
      if (!allowed.has(String(entry.createdBy))) {
        throw new ForbiddenException('You do not have permission to perform this action');
      }
    }

    const normalizedName = dto.name.trim();
    const duplicate = await this.entryModel.findOne({
      _id: { $ne: id },
      name: this.exactNameRegex(normalizedName),
    });
    if (duplicate) throw new ConflictException('An entry with this name already exists');

    const existingByName = new Map(entry.fields.map((field) => [field.name, field]));
    const fields = await this.resolveFields(dto.fields, actor.role, existingByName);
    const { rawTotal, fieldOperators } = this.combineTotals(fields);
    const { sign } = await this.fieldsService.getFinalTotalSettings();
    const finalTotal = sign === 'subtract' ? -rawTotal : rawTotal;
    const newDate = new Date(dto.date);
    const changes = this.diffEntry(entry, normalizedName, newDate, fields);

    entry.set({
      name: normalizedName,
      date: newDate,
      fields,
      fieldOperators: fields.length > 1 ? fieldOperators : [],
      finalTotal,
      updatedBy: new Types.ObjectId(actor.sub),
    });

    if (changes.length > 0) {
      entry.history = [
        { updatedAt: new Date(), updatedBy: new Types.ObjectId(actor.sub), changes },
        ...entry.history,
      ].slice(0, 5);
    }

    try {
      await entry.save();
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('An entry with this name already exists');
      }
      throw error;
    }
    return entry.populate(
      ['createdBy', 'updatedBy', 'history.updatedBy'].map((path) => ({ path, select: 'name email role' })),
    );
  }

  async remove(id: string) {
    const deleted = await this.entryModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Entry not found');
    return { message: 'Entry removed' };
  }

  async exportToExcel(query: { name?: string; startDate?: string; endDate?: string }, actor?: ReportActor) {
    const filter = await this.scopeFilterForActor(this.buildFilter(query), actor);
    const entries = await this.entryModel
      .find(filter)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
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
    columns.push({ header: 'Updated By', key: 'updatedBy', width: 20 });
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };

    for (const e of entries) {
      const row: Record<string, unknown> = {
        name: e.name,
        date: e.date.toISOString().split('T')[0],
        fieldOperators: e.fieldOperators.join(' '),
        finalTotal: e.finalTotal,
        createdBy: (e.createdBy as any)?.name || '',
        updatedBy: (e.updatedBy as any)?.name || '',
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

  async exportToPdf(query: { name?: string; startDate?: string; endDate?: string }, actor?: ReportActor) {
    const filter = await this.scopeFilterForActor(this.buildFilter(query), actor);
    const entries = await this.entryModel
      .find(filter)
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
