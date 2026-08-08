import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Field, FieldDocument } from './field.schema';
import { FinalTotalSettings, FinalTotalSettingsDocument } from './final-total-settings.schema';
import { UpsertFieldDto } from './dto/upsert-field.dto';
import { UpdateFinalTotalSettingsDto } from './dto/update-final-total-settings.dto';

type BoxFieldDef = {
  label: string;
  type: 'text' | 'number' | 'date' | 'time' | 'computed';
  auto?: 'serial' | 'user' | 'constant';
  constant?: number;
  sumTotal?: boolean;
  sumSign?: 'add' | 'subtract';
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
  constructor(
    @InjectModel(Field.name) private fieldModel: Model<FieldDocument>,
    @InjectModel(FinalTotalSettings.name) private finalTotalSettingsModel: Model<FinalTotalSettingsDocument>,
  ) {}

  async getFinalTotalSettings(): Promise<{ label: string; icon: string; sign: 'add' | 'subtract' }> {
    const settings = await this.finalTotalSettingsModel.findOne();
    return {
      label: settings?.label || 'Final Total',
      icon: settings?.icon || '',
      sign: settings?.sign === 'subtract' ? 'subtract' : 'add',
    };
  }

  async updateFinalTotalSettings(dto: UpdateFinalTotalSettingsDto) {
    const updated = await this.finalTotalSettingsModel.findOneAndUpdate(
      {},
      { label: dto.label.trim() || 'Final Total', icon: dto.icon || '', sign: dto.sign === 'subtract' ? 'subtract' : 'add' },
      { upsert: true, new: true },
    );
    return { label: updated.label, icon: updated.icon, sign: updated.sign };
  }

  // `viewer` is omitted for internal/system callers (report merging, entry save
  // resolution, migrations) which must always see every field regardless of who
  // triggered them. Pass it only from request-driven reads.
  async findAll(viewer?: { sub?: string; permissions?: Record<string, boolean> }) {
    const fields = await this.fieldModel.find().sort({ order: 1, createdAt: 1 });
    if (!viewer || viewer.permissions?.manageFields) return fields;
    return fields.filter((field) => this.isVisibleTo(field, viewer.sub));
  }

  // A field with an empty visibleTo list is visible to everyone. A non-empty list
  // hides the field from every account except the ones listed (superadmin/manageFields
  // callers bypass this entirely — see findAll above).
  private isVisibleTo(field: Field, accountId?: string) {
    if (!field.visibleTo || field.visibleTo.length === 0) return true;
    return Boolean(accountId) && field.visibleTo.some((id) => String(id) === String(accountId));
  }

  // Lightweight, name-keyed lock map available to any authenticated account.
  async findEditLocks() {
    const fields = await this.fieldModel.find().select('name userOnlyEdit');
    return fields.map((field) => ({ name: field.name, userOnlyEdit: field.userOnlyEdit }));
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
    const boxColors = boxNames.map((_, index) => dto.boxColors?.[index] || '');

    const userOnlyEdit = Boolean(dto.userOnlyEdit);

    const visibleTo = Array.from(
      new Set((dto.visibleTo || []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())),
    );

    const boxFields = boxNames.map((_, index) => {
      const sanitized: BoxFieldDef[] = (dto.boxFields?.[index] || [])
        .filter((field) => field && typeof field.label === 'string' && field.label.trim())
        .map((field: any) => {
          const type = (BOX_FIELD_TYPES.includes(field.type) ? field.type : 'text') as BoxFieldDef['type'];
          const auto = type !== 'computed' && BOX_FIELD_AUTO.includes(field.auto) ? (field.auto as BoxFieldDef['auto']) : undefined;
          const constant = auto === 'constant' ? Number(field.constant) || 0 : undefined;
          const sumTotal = type === 'number' || type === 'computed' ? Boolean(field.sumTotal) : undefined;
          const sumSign = sumTotal && field.sumSign === 'subtract' ? 'subtract' : undefined;
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
            ...(sumSign ? { sumSign } : {}),
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
      color: dto.color || '',
      boxIcons,
      boxColors,
      boxFields,
      userOnlyEdit,
      visibleTo,
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

    const previousName = field.name;
    field.set(normalized);
    const saved = await field.save();
    if (previousName !== saved.name) {
      // Field names are the stable key used by saved report snapshots. Keep
      // existing values attached when a superadmin renames a field.
      await this.fieldModel.db.collection('entries').updateMany(
        { 'fields.name': previousName },
        { $set: { 'fields.$[field].name': saved.name } },
        { arrayFilters: [{ 'field.name': previousName }] },
      );
    }
    return saved;
  }

  async remove(id: string) {
    const deleted = await this.fieldModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Field not found');
    return { message: 'Field removed' };
  }
}
