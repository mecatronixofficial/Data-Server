import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Field, FieldDocument } from './field.schema';
import { UpsertFieldDto } from './dto/upsert-field.dto';

@Injectable()
export class FieldsService {
  constructor(@InjectModel(Field.name) private fieldModel: Model<FieldDocument>) {}

  async findAll() {
    return this.fieldModel.find().sort({ order: 1, createdAt: 1 });
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

    return {
      name: dto.name.trim(),
      order: dto.order ?? 0,
      boxNames,
      calcType,
      groupSplit,
      icon: dto.icon || '',
      boxIcons,
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
