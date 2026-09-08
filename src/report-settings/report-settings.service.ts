import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ReportSettings, ReportSettingsDocument } from './report-settings.schema';

@Injectable()
export class ReportSettingsService {
  constructor(
    @InjectModel(ReportSettings.name) private reportSettingsModel: Model<ReportSettingsDocument>,
  ) {}

  async getSettings() {
    const settings = await this.reportSettingsModel.findOne().lean();
    return { visibleColumns: settings?.visibleColumns ?? null };
  }

  async updateSettings(visibleColumns: string[]) {
    const updated = await this.reportSettingsModel.findOneAndUpdate(
      {},
      { visibleColumns },
      { upsert: true, new: true },
    );
    return { visibleColumns: updated.visibleColumns };
  }
}
