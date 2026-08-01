import {
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

export type ReportActor = {
  sub: string;
  role: string;
  name: string;
  permissions?: Record<string, boolean>;
};
export type ReportQuery = {
  name?: string;
  startDate?: string;
  endDate?: string;
  scope?: 'mine' | 'team' | 'all';
  ownerRole?: 'admin' | 'user';
  teamName?: string;
};

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

  private async teamReportMigrationAlreadyApplied() {
    const legacyEntries = await this.entryModel.countDocuments({
      $or: [{ teamAdminId: null }, { teamAdminId: { $exists: false } }],
    });
    if (legacyEntries > 0) return false;

    const duplicateTeams = await this.entryModel.aggregate([
      { $match: { teamAdminId: { $type: 'objectId' } } },
      { $group: { _id: '$teamAdminId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]);
    if (duplicateTeams.length > 0) return false;

    const indexes = await this.entryModel.collection.indexes();
    const uniqueTeamIndex = indexes.find((index) => index.name === 'unique_team_report');
    return Boolean(uniqueTeamIndex?.unique);
  }

  async migrateTeamReports() {
    const migrationId = '20260801-team-report-v1';
    const migrations = this.entryModel.db.collection('app_migrations');
    const previous = await migrations.findOne({ _id: migrationId } as any);
    if (previous?.status === 'complete') {
      return { migrationId, status: 'already-complete' as const };
    }
    if (previous?.status === 'running') {
      throw new Error(`Migration ${migrationId} is already running`);
    }

    const startedAt = new Date();
    if (previous) {
      const lock = await migrations.updateOne(
        { _id: migrationId, status: previous.status } as any,
        { $set: { status: 'running', startedAt }, $unset: { completedAt: '', error: '' } },
      );
      if (lock.modifiedCount !== 1) throw new Error(`Could not acquire migration lock for ${migrationId}`);
    } else {
      try {
        await migrations.insertOne({ _id: migrationId, status: 'running', startedAt } as any);
      } catch (error: any) {
        if (error?.code === 11000) throw new Error(`Migration ${migrationId} is already running`);
        throw error;
      }
    }

    try {
      await this.usersService.ensureTeamNames();
      if (await this.teamReportMigrationAlreadyApplied()) {
        const completedAt = new Date();
        await migrations.updateOne(
          { _id: migrationId } as any,
          { $set: { status: 'complete', completedAt }, $unset: { error: '' } },
        );
        return { migrationId, status: 'verified-complete' as const, completedAt };
      }

      // Remove the old global/per-account uniqueness before consolidating existing
      // data. The replacement unique team index is created after the migration.
      const indexes = await this.entryModel.collection.indexes();
      for (const index of indexes) {
        const keys = Object.keys(index.key || {});
        const obsolete = index.name === 'name_1'
          || index.name === 'isActive_1'
          || (Boolean(index.unique) && keys.length === 1 && keys[0] === 'ownerAccountId');
        if (obsolete && index.name) {
          try {
            await this.entryModel.collection.dropIndex(index.name);
          } catch (error: any) {
            if (error?.code !== 27 && error?.codeName !== 'IndexNotFound') throw error;
          }
        }
      }

      // Attach unambiguous legacy reports to a team. Ambiguous records stay visible
      // to superadmin instead of risking a wrong merge.
      const legacyEntries = await this.entryModel
        .find({ teamAdminId: null })
        .sort({ updatedAt: -1 });
      for (const entry of legacyEntries) {
        const context = await this.usersService.getLegacyReportContext(
          entry.name,
          entry.createdBy ? String(entry.createdBy) : undefined,
        );
        if (!context) continue;
        await this.entryModel.updateOne(
          { _id: entry._id, teamAdminId: null },
          {
            $set: {
              name: context.teamName,
              ownerAccountId: new Types.ObjectId(context.teamAdminId),
              ownerRole: 'admin',
              teamAdminId: new Types.ObjectId(context.teamAdminId),
              teamName: context.teamName,
            },
          },
        );
      }

      await this.consolidateTeamReports();
      try {
        await this.entryModel.collection.createIndex(
          { teamAdminId: 1 },
          {
            name: 'unique_team_report',
            unique: true,
            partialFilterExpression: { teamAdminId: { $type: 'objectId' } },
          },
        );
      } catch (error: any) {
        if (error?.codeName !== 'IndexOptionsConflict' && error?.code !== 85 && error?.code !== 86) {
          throw error;
        }
      }

      const completedAt = new Date();
      await migrations.updateOne(
        { _id: migrationId } as any,
        { $set: { status: 'complete', completedAt }, $unset: { error: '' } },
      );
      return { migrationId, status: 'complete' as const, completedAt };
    } catch (error: any) {
      await migrations.updateOne(
        { _id: migrationId } as any,
        { $set: { status: 'failed', failedAt: new Date(), error: String(error?.message || error) } },
      );
      throw error;
    }
  }

  private documentTime(entry: EntryDocument, key: 'createdAt' | 'updatedAt') {
    const value = (entry as any)[key];
    return value instanceof Date ? value.getTime() : 0;
  }

  // Older builds created one document for the admin and another for every user.
  // Collapse those documents into one team report. For each configured field we
  // prefer the newest document written by the role allowed to edit that field,
  // so user work and admin work are both retained.
  private async consolidateTeamReports() {
    const teamIds = await this.entryModel.distinct('teamAdminId', {
      teamAdminId: { $type: 'objectId' },
    });
    const fieldDefinitions = await this.fieldsService.findAll();

    for (const teamId of teamIds) {
      const reports = await this.entryModel
        .find({ teamAdminId: teamId })
        .sort({ updatedAt: -1 });
      if (reports.length === 0) continue;

      const newest = reports[0];
      const canonical = reports.find((report) => String(report.ownerAccountId) === String(teamId))
        || newest;
      const teamName = newest.teamName || canonical.teamName || canonical.name;

      if (reports.length === 1) {
        await this.entryModel.updateOne(
          { _id: canonical._id },
          {
            $set: {
              name: teamName,
              ownerAccountId: new Types.ObjectId(String(teamId)),
              ownerRole: 'admin',
              teamAdminId: new Types.ObjectId(String(teamId)),
              teamName,
            },
          },
        );
        continue;
      }

      const mergedFields: EntryField[] = [];
      const configuredNames = new Set(fieldDefinitions.map((field) => field.name));
      for (const definition of fieldDefinitions) {
        const preferredRole = definition.userOnlyEdit ? 'user' : 'admin';
        const preferred = reports.find((report) =>
          report.ownerRole === preferredRole
          && report.fields.some((field) => field.name === definition.name),
        );
        const fallback = reports.find((report) =>
          report.fields.some((field) => field.name === definition.name),
        );
        const source = preferred || fallback;
        const field = source?.fields.find((item) => item.name === definition.name);
        if (field) mergedFields.push((field as any).toObject?.() || field);
      }

      // Preserve removed/legacy field snapshots too, choosing the newest copy.
      for (const report of reports) {
        for (const field of report.fields) {
          if (!configuredNames.has(field.name) && !mergedFields.some((item) => item.name === field.name)) {
            mergedFields.push((field as any).toObject?.() || field);
          }
        }
      }

      const { sign } = await this.fieldsService.getFinalTotalSettings();
      const { finalTotal, fieldOperators } = this.combineTotals(mergedFields, sign);
      const history = reports
        .flatMap((report) => report.history || [])
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5)
        .map((item: any) => item.toObject?.() || item);
      const oldest = [...reports].sort(
        (a, b) => this.documentTime(a, 'createdAt') - this.documentTime(b, 'createdAt'),
      )[0];

      canonical.set({
        name: teamName,
        date: newest.date,
        fields: mergedFields,
        fieldOperators,
        finalTotal,
        createdBy: oldest.createdBy || canonical.createdBy,
        updatedBy: newest.updatedBy || newest.createdBy || canonical.updatedBy,
        ownerAccountId: new Types.ObjectId(String(teamId)),
        ownerRole: 'admin',
        teamAdminId: new Types.ObjectId(String(teamId)),
        teamName,
        history,
      });
      await canonical.save();
      const backups = this.entryModel.db.collection('entry_team_merge_backups');
      for (const duplicate of reports.filter((report) => String(report._id) !== String(canonical._id))) {
        const snapshot: any = duplicate.toObject({ depopulate: true });
        delete snapshot._id;
        await backups.updateOne(
          { sourceEntryId: duplicate._id },
          {
            $setOnInsert: {
              sourceEntryId: duplicate._id,
              mergedIntoEntryId: canonical._id,
              backedUpAt: new Date(),
              snapshot,
            },
          },
          { upsert: true },
        );
      }
      await this.entryModel.deleteMany({
        teamAdminId: teamId,
        _id: { $ne: canonical._id },
      });
    }
  }

  private async scopeFilterForActor(filter: any, actor: ReportActor, query: ReportQuery) {
    if (actor.role === 'user') {
      throw new ForbiddenException('Users do not have permission to view reports');
    }

    if (actor.role === 'admin') {
      // Admin and assigned users share one canonical document for this team.
      // "mine" and "team" therefore intentionally resolve to the same report.
      filter.teamAdminId = new Types.ObjectId(actor.sub);
      return filter;
    }

    if (actor.role === 'superadmin') {
      if (query.ownerRole) filter.ownerRole = query.ownerRole;
      if (query.teamName) filter.teamName = this.exactNameRegex(query.teamName);
      return filter;
    }

    throw new ForbiddenException('You do not have permission to view reports');
  }

  // Whether this actor is allowed to write this field's values, per Field.userOnlyEdit:
  // superadmin always can; admin can unless the field is locked to the user; user can
  // only on fields locked to them. Lets one entry be jointly filled by an admin and the
  // users assigned to that team, each role owning a different subset of fields.
  private canEditField(actorRole: string, field: Field) {
    if (actorRole === 'superadmin') return true;
    if (actorRole === 'admin') return !field.userOnlyEdit;
    if (actorRole === 'user') return Boolean(field.userOnlyEdit);
    return false;
  }

  // Field names/box counts always come from the live Field config (server-trusted).
  // Stale entries are resized safely when boxes are added or removed. Values for a
  // field this actor cannot edit are never taken from the client: they keep the latest
  // saved value (update) or start blank (create), no matter what was submitted.
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
      const allowed = this.canEditField(actorRole, field);
      const existing = existingByName?.get(field.name);
      const boxes = field.boxNames.map((_, index) => {
        if (!allowed) return Number(existing?.boxes?.[index]) || 0;
        return input.boxes[index] !== undefined
          ? Number(input.boxes[index]) || 0
          : Number(existing?.boxes?.[index]) || 0;
      });
      const details = field.boxNames.map((_, index) => {
        if (!allowed) return existing?.details?.[index] || [];
        return input.details?.[index] || existing?.details?.[index] || [];
      });
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

  // Apply the single superadmin-selected operator between consecutive field totals.
  private combineTotals(fields: EntryField[], sign: 'add' | 'subtract') {
    const operator = sign === 'subtract' ? '-' : '+';
    const fieldOperators = fields.length > 1 ? Array(fields.length - 1).fill(operator) : [];
    const finalTotal = fields.length === 0
      ? 0
      : fields.slice(1).reduce(
          (total, field) => applyOperator(total, field.total, operator),
          fields[0].total,
        );
    return { finalTotal, fieldOperators };
  }

  // Escapes a name for safe use inside a case-insensitive exact-match $regex.
  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private exactNameRegex(value: string) {
    return { $regex: `^${this.escapeRegex(value)}$`, $options: 'i' };
  }

  private async claimLegacyReport(
    context: {
      ownerAccountId: string;
      ownerName: string;
      ownerRole: string;
      teamAdminId: string;
      teamName: string;
    },
    actor: ReportActor,
  ) {
    const candidates = await this.entryModel
      .find({
        ownerAccountId: null,
        $or: [
          { createdBy: actor.sub },
          { name: this.exactNameRegex(context.ownerName) },
        ],
      })
      .sort({ updatedAt: -1 });

    for (const candidate of candidates) {
      const legacyContext = await this.usersService.getLegacyReportContext(
        candidate.name,
        candidate.createdBy ? String(candidate.createdBy) : undefined,
      );
      if (legacyContext?.ownerAccountId !== context.ownerAccountId) continue;

      try {
        const claimed = await this.entryModel.findOneAndUpdate(
          { _id: candidate._id, teamAdminId: null },
          {
            $set: {
              name: context.teamName,
              ownerAccountId: new Types.ObjectId(context.teamAdminId),
              ownerRole: 'admin',
              teamAdminId: new Types.ObjectId(context.teamAdminId),
              teamName: context.teamName,
            },
          },
          { new: true },
        );
        if (claimed) return claimed;
      } catch (error: any) {
        // A concurrent request may already have claimed/created the report.
        if (error?.code !== 11000) throw error;
      }
    }

    return null;
  }

  private async dropObsoleteDuplicateIndex(error: any) {
    if (error?.code !== 11000) return false;
    const errorText = String(error?.message || '');
    const duplicateFields = new Set([
      ...Object.keys(error?.keyPattern || {}),
      ...Object.keys(error?.keyValue || {}),
    ]);
    const indexName = duplicateFields.has('name') || errorText.includes('name_1')
      ? 'name_1'
      : duplicateFields.has('isActive') || errorText.includes('isActive_1')
        ? 'isActive_1'
        : duplicateFields.has('ownerAccountId') || errorText.includes('ownerAccountId_1')
          ? 'ownerAccountId_1'
        : null;
    if (!indexName) return false;

    try {
      await this.entryModel.collection.dropIndex(indexName);
    } catch (dropError: any) {
      if (dropError?.code !== 27 && dropError?.codeName !== 'IndexNotFound') throw dropError;
    }
    return true;
  }

  async create(dto: CreateEntryDto, actor: ReportActor) {
    const context = await this.usersService.getReportContext(actor.sub);
    const teamAdminId = new Types.ObjectId(context.teamAdminId);
    const existing = await this.entryModel.findOne({ teamAdminId });
    // POST is intentionally idempotent for one-report-per-team. A stale tab
    // or concurrent first save must update the canonical report, not fail.
    if (existing) {
      return this.update(String(existing._id), dto, actor);
    }
    const legacy = await this.claimLegacyReport(context, actor);
    if (legacy) {
      return this.update(String(legacy._id), dto, actor);
    }

    const fields = await this.resolveFields(dto.fields, actor.role);
    const { sign } = await this.fieldsService.getFinalTotalSettings();
    const { finalTotal, fieldOperators } = this.combineTotals(fields, sign);

    const insertValues = {
      name: context.teamName,
      date: new Date(dto.date),
      fields,
      fieldOperators: fields.length > 1 ? fieldOperators : [],
      finalTotal,
      createdBy: new Types.ObjectId(actor.sub),
      ownerAccountId: new Types.ObjectId(context.teamAdminId),
      ownerRole: 'admin',
      teamAdminId: new Types.ObjectId(context.teamAdminId),
      teamName: context.teamName,
    };

    try {
      // Use the unique teamAdminId index as an atomic find-or-create lock.
      // This removes the gap between the earlier lookup and insert that allowed
      // two first-save requests (or two open tabs) to race each other.
      const canonical = await this.entryModel.findOneAndUpdate(
        { teamAdminId },
        { $setOnInsert: insertValues },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      if (!canonical) {
        throw new ConflictException('Your report could not be created. Please try again.');
      }
      // Applying the submitted values through update() keeps the same field-level
      // admin/user authorization for both a newly inserted and an existing report.
      return this.update(String(canonical._id), dto, actor);
    } catch (error: any) {
      if (error?.code === 11000) {
        if (await this.dropObsoleteDuplicateIndex(error)) {
          return this.create(dto, actor);
        }
        // Defensive recovery for a concurrent upsert. Query both the expected
        // owner and the duplicate key reported by MongoDB before surfacing an error.
        const duplicateTeamId = error?.keyValue?.teamAdminId;
        const canonical = await this.entryModel.findOne({
          teamAdminId: duplicateTeamId || teamAdminId,
        });
        if (canonical && String(canonical.teamAdminId) === context.teamAdminId) {
          return this.update(String(canonical._id), dto, actor);
        }
        throw new ConflictException('Your report changed while saving. Refresh and try again.');
      }
      throw error;
    }
  }

  async findActiveForActor(actor: ReportActor) {
    if (actor.role === 'superadmin') return null;
    const context = await this.usersService.getReportContext(actor.sub);
    const active = await this.entryModel.findOne({
      teamAdminId: new Types.ObjectId(context.teamAdminId),
    });
    if (!active) return null;
    return active;
  }

  async updateActive(
    expectedId: string,
    dto: CreateEntryDto,
    actor: { sub: string; name: string; role: string; permissions?: Record<string, boolean> },
  ) {
    const context = await this.usersService.getReportContext(actor.sub);
    const active = await this.entryModel.findOne({
      teamAdminId: new Types.ObjectId(context.teamAdminId),
    });
    if (!active) throw new NotFoundException('Your team report does not exist yet');
    if (String(active._id) !== expectedId) {
      throw new ConflictException('Your report has changed. Refresh before entering values.');
    }
    return this.update(expectedId, dto, actor);
  }

  async findMine(actor: ReportActor) {
    const context = await this.usersService.getReportContext(actor.sub);
    return this.entryModel
      .find({ teamAdminId: new Types.ObjectId(context.teamAdminId) })
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role')
      .populate('history.updatedBy', 'name email role')
      .sort({ date: -1 });
  }

  private buildFilter(query: ReportQuery) {
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

  async findAll(query: ReportQuery, actor: ReportActor) {
    const filter = await this.scopeFilterForActor(this.buildFilter(query), actor, query);
    return this.entryModel
      .find(filter)
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role')
      .populate('history.updatedBy', 'name email role')
      .sort({ updatedAt: -1 });
  }

  async findOne(id: string, actor: ReportActor) {
    const entry = await this.entryModel
      .findById(id)
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role')
      .populate('history.updatedBy', 'name email role');
    if (!entry) throw new NotFoundException('Entry not found');
    const actorContext = actor.role === 'superadmin'
      ? null
      : await this.usersService.getReportContext(actor.sub);
    const isTeamMember = actorContext
      && String(entry.teamAdminId) === actorContext.teamAdminId;
    if (actor.role !== 'superadmin' && !isTeamMember) {
      throw new NotFoundException('Entry not found');
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
    concurrencyRetry = 0,
  ) {
    const entry = await this.entryModel.findById(id);
    if (!entry) throw new NotFoundException('Entry not found');

    // Admins and assigned users are authorized by team membership. They update
    // different field subsets, but always on this same canonical document.
    const actorContext = actor.role === 'superadmin'
      ? null
      : await this.usersService.getReportContext(actor.sub);
    const isTeamMember = actorContext
      && String(entry.teamAdminId) === actorContext.teamAdminId;
    if (actor.role !== 'superadmin' && !isTeamMember) {
      throw new ForbiddenException('You can only update your own team report');
    }
    const context = actorContext || (entry.teamAdminId
      ? await this.usersService
          .getReportContext(String(entry.teamAdminId))
          .catch((error) => {
            if (error instanceof NotFoundException) return null;
            throw error;
          })
      : null);

    // An admin (unlike superadmin) may only manage entries within their own team —
    // their own record or one of the users assigned to them (mirrors findOne/scopeFilterForActor).
    // Visibility-based collaborators may update their permitted field values, but
    // cannot rename or re-date a record outside their assigned team.
    // The team name identifies this working record and remains stable.
    const normalizedName = context?.teamName || entry.teamName || entry.name;

    const existingByName = new Map(entry.fields.map((field) => [field.name, field]));
    const resolvedFields = await this.resolveFields(dto.fields, actor.role, existingByName);
    // A collaborator may only receive a subset of the configured fields. Preserve
    // every unsubmitted field exactly as it was so another account's saved work is
    // never erased, then append any newly configured submitted fields.
    const resolvedByName = new Map(resolvedFields.map((field) => [field.name, field]));
    const existingNames = new Set(entry.fields.map((field) => field.name));
    const fields: EntryField[] = [
      ...entry.fields.map((field) => resolvedByName.get(field.name) || field),
      ...resolvedFields.filter((field) => !existingNames.has(field.name)),
    ];
    const { sign } = await this.fieldsService.getFinalTotalSettings();
    const { finalTotal, fieldOperators } = this.combineTotals(fields, sign);
    const newDate = new Date(dto.date);
    const changes = this.diffEntry(entry, normalizedName, newDate, fields);

    entry.set({
      name: normalizedName,
      date: newDate,
      fields,
      fieldOperators: fields.length > 1 ? fieldOperators : [],
      finalTotal,
      updatedBy: new Types.ObjectId(actor.sub),
      ...(context ? {
        ownerAccountId: new Types.ObjectId(context.teamAdminId),
        ownerRole: 'admin',
        teamAdminId: new Types.ObjectId(context.teamAdminId),
        teamName: context.teamName,
      } : {}),
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
      if (error?.name === 'VersionError' && concurrencyRetry < 1) {
        // Admin and User own different fields. Re-read once and re-apply this
        // actor's permitted values so a simultaneous save preserves both sides.
        return this.update(id, dto, actor, concurrencyRetry + 1);
      }
      if (error?.name === 'VersionError') {
        throw new ConflictException('This report changed while you were saving. Please try again.');
      }
      if (error?.code === 11000) {
        throw new ConflictException('This team already has a report');
      }
      throw error;
    }
    return entry.populate(
      ['createdBy', 'updatedBy', 'history.updatedBy'].map((path) => ({ path, select: 'name email role' })),
    );
  }

  async remove(id: string, actor: ReportActor) {
    const entry = await this.entryModel.findById(id);
    if (!entry) throw new NotFoundException('Entry not found');
    const isTeamAdmin = actor.role === 'admin' && String(entry.teamAdminId) === actor.sub;
    if (actor.role !== 'superadmin' && !isTeamAdmin) {
      throw new ForbiddenException('You can only remove reports from your own team');
    }
    await entry.deleteOne();
    return { message: 'Entry removed' };
  }

  async exportToExcel(query: ReportQuery, actor: ReportActor) {
    const filter = await this.scopeFilterForActor(this.buildFilter(query), actor, query);
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
      { header: 'Team', key: 'teamName', width: 24 },
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
        teamName: e.teamName || 'Legacy / Unassigned',
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

  async exportToPdf(query: ReportQuery, actor: ReportActor) {
    const filter = await this.scopeFilterForActor(this.buildFilter(query), actor, query);
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
        lines.push(`1 0 0 1 420 700 Tm (${escapePdf(`Team: ${entry.teamName || 'Legacy / Unassigned'}`)}) Tj`);
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
