import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RecordEntry, RecordEntryDocument } from './record.schema';
import { Field, FieldDocument } from '../fields/field.schema';
import { User, UserDocument } from '../users/user.schema';
import { UpsertRecordDto } from './dto/upsert-record.dto';

@Injectable()
export class RecordsService {
  constructor(
    @InjectModel(RecordEntry.name) private recordModel: Model<RecordEntryDocument>,
    @InjectModel(Field.name) private fieldModel: Model<FieldDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async findAll() {
    return this.recordModel
      .find()
      .sort({ createdAt: -1 })
      .populate('fields.fieldId', 'name')
      .populate('fields.userId', 'name')
      .populate('adminIds', 'name');
  }

  // An admin sees every record they supervise, with all of its fields/users intact —
  // they oversee the whole record. A user sees the same records but only the field(s)
  // within each one that are actually assigned to them, not a teammate's assignments.
  async findMine(userId: string, role: string) {
    const filter = role === 'admin' ? { adminIds: userId } : { 'fields.userId': userId };
    const records = await this.recordModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('fields.fieldId', 'name')
      .populate('fields.userId', 'name')
      .populate('adminIds', 'name');

    if (role === 'admin') return records;

    return records.map((record) => {
      const plain = record.toObject();
      plain.fields = plain.fields.filter((f: any) => String(f.userId?._id ?? f.userId) === userId);
      return plain;
    });
  }

  private async assertFieldsExist(fieldIds: string[]) {
    const unique = [...new Set(fieldIds)];
    const count = await this.fieldModel.countDocuments({ _id: { $in: unique } });
    if (count !== unique.length) throw new NotFoundException('One or more fields were not found');
  }

  private async assertAdminsExist(adminIds: string[]) {
    const unique = [...new Set(adminIds)];
    const count = await this.userModel.countDocuments({ _id: { $in: unique }, role: 'admin' });
    if (count !== unique.length) throw new NotFoundException('One or more admins were not found');
    return unique;
  }

  private async assertUsersExist(userIds: string[], adminIds: string[]) {
    const unique = [...new Set(userIds)];
    const count = await this.userModel.countDocuments({
      _id: { $in: unique },
      role: 'user',
      assignedAdminId: { $in: adminIds },
      isActive: { $ne: false },
    });
    if (count !== unique.length) {
      throw new BadRequestException('Every assigned user must be active and belong to a selected admin');
    }
  }

  private async validateFields(fields: { fieldId: string; userId: string }[], adminIds: string[]) {
    if (new Set(fields.map((field) => field.fieldId)).size !== fields.length) {
      throw new BadRequestException('Each field may only be assigned once per record');
    }
    await Promise.all([
      this.assertFieldsExist(fields.map((f) => f.fieldId)),
      this.assertUsersExist(fields.map((f) => f.userId), adminIds),
    ]);
    return fields.map((f) => ({ fieldId: f.fieldId, userId: f.userId }));
  }

  // Assigned record fields are user-owned work, so admins can view their values while
  // the assigned user edits them.
  private async applyFieldWorkAssignment(fields: { fieldId: string; userId: string }[]) {
    if (fields.length === 0) return;
    await this.fieldModel.bulkWrite(
      fields.map(({ fieldId }) => ({
        updateOne: {
          filter: { _id: fieldId },
          update: { $set: { userOnlyEdit: true } },
        },
      })),
    );
  }

  async create(dto: UpsertRecordDto) {
    const adminIds = await this.assertAdminsExist(dto.adminIds);
    const fields = await this.validateFields(dto.fields, adminIds);
    const created = new this.recordModel({ name: dto.name.trim(), fields, adminIds });
    await created.save();
    await this.applyFieldWorkAssignment(fields);
    return created.populate([
      { path: 'fields.fieldId', select: 'name' },
      { path: 'fields.userId', select: 'name' },
      { path: 'adminIds', select: 'name' },
    ]);
  }

  async update(id: string, dto: UpsertRecordDto) {
    const record = await this.recordModel.findById(id);
    if (!record) throw new NotFoundException('Record not found');

    const adminIds = await this.assertAdminsExist(dto.adminIds);
    const fields = await this.validateFields(dto.fields, adminIds);
    record.set({ name: dto.name.trim(), fields, adminIds });
    await record.save();
    await this.applyFieldWorkAssignment(fields);
    return record.populate([
      { path: 'fields.fieldId', select: 'name' },
      { path: 'fields.userId', select: 'name' },
      { path: 'adminIds', select: 'name' },
    ]);
  }

  async remove(id: string) {
    const deleted = await this.recordModel.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundException('Record not found');
    return { message: 'Record removed' };
  }
}
