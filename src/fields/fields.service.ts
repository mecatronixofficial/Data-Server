import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Field, FieldDocument } from './field.schema';
import { UpsertFieldDto } from './dto/upsert-field.dto';

type BoxFieldDef = {
  label: string;
  type: 'text' | 'number' | 'date' | 'time' | 'computed';
  auto?: 'serial' | 'user' | 'constant';
  constant?: number;
  sumTotal?: boolean;
  formula?: { op: 'multiply' | 'percentAdd'; a: string; b: string };
};

const DEFAULT_BOX_FIELDS: BoxFieldDef[] = [
  { label: 'Name', type: 'text' },
  { label: 'Value', type: 'number', sumTotal: true },
];

const BOX_FIELD_TYPES = ['text', 'number', 'date', 'time', 'computed'];
const BOX_FIELD_AUTO = ['serial', 'user', 'constant'];
const BOX_FIELD_FORMULA_OPS = ['multiply', 'percentAdd'];

@Injectable()
export class FieldsService {
  constructor(@InjectModel(Field.name) private fieldModel: Model<FieldDocument>) {}

  async findAll() {
    return this.fieldModel.find().sort({ order: 1, createdAt: 1 });
  }

  async findVisibleToUser(userId: string) {
    return this.fieldModel.find({ visibleUserIds: userId }).sort({ order: 1, createdAt: 1 });
  }

  private normalize(dto: UpsertFieldDto) {
    const boxNames = dto.boxNames.map((boxName, index) => boxName.trim() || `Box ${index + 1}`);
    const calcType = dto.calcType || 'signed';

    let groupSplit = 0;
    if (calcType === 'grouped') {
      groupSplit = dto.groupSplit ?? Math.ceil(boxNames.length / 2);
      if (groupSplit < 1 || groupSplit > boxNames.length - 1) {
        throw new BadRequestException('Split point must leave at least one box in each group');
      }
    }

    const boxIcons = boxNames.map((_, index) => dto.boxIcons?.[index] || '');

    const visibleUserIds = [...new Set(dto.visibleUserIds || [])];

    const boxFields = boxNames.map((_, index) => {
      const sanitized: BoxFieldDef[] = (dto.boxFields?.[index] || [])
        .filter((field) => field && typeof field.label === 'string' && field.label.trim())
        .map((field: any) => {
          const type = (BOX_FIELD_TYPES.includes(field.type) ? field.type : 'text') as BoxFieldDef['type'];
          const auto = type !== 'computed' && BOX_FIELD_AUTO.includes(field.auto) ? (field.auto as BoxFieldDef['auto']) : undefined;
          const constant = auto === 'constant' ? Number(field.constant) || 0 : undefined;
          const sumTotal = type === 'number' || type === 'computed' ? Boolean(field.sumTotal) : undefined;
          const formula =
            type === 'computed' && field.formula && BOX_FIELD_FORMULA_OPS.includes(field.formula.op) &&
            typeof field.formula.a === 'string' && typeof field.formula.b === 'string'
              ? { op: field.formula.op, a: field.formula.a.trim(), b: field.formula.b.trim() }
              : undefined;
          return {
            label: field.label.trim(),
            type,
            ...(auto ? { auto } : {}),
            ...(constant !== undefined ? { constant } : {}),
            ...(sumTotal ? { sumTotal } : {}),
            ...(formula ? { formula } : {}),
          };
        });
      return sanitized.length ? sanitized : DEFAULT_BOX_FIELDS;
    });

    return {
      name: dto.name.trim(),
      order: dto.order ?? 0,
      boxNames,
      calcType,
      groupSplit,
      icon: dto.icon || '',
      boxIcons,
      boxFields,
      visibleUserIds,
    };
  }

  async create(dto: UpsertFieldDto) {
    const normalized = this.normalize(dto);
    const existing = await this.fieldModel.findOne({ name: normalized.name });
    if (existing) throw new ConflictException('A field with this name already exists');

    const created = new this.fieldModel(normalized);
    return created.save();
  }

  async update(id: string, dto: UpsertFieldDto) {
    const field = await this.fieldModel.findById(id);
    if (!field) throw new NotFoundException('Field not found');

    const normalized = this.normalize(dto);
    if (normalized.name !== field.name) {
      const duplicate = await this.fieldModel.findOne({ name: normalized.name, _id: { $ne: id } });
      if (duplicate) throw new ConflictException('A field with this name already exists');
    }

    field.set(normalized);
    return field.save();
  }

  async remove(id: string) {
    const deleted = await this.fieldModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Field not found');
    return { message: 'Field removed' };
  }
}
