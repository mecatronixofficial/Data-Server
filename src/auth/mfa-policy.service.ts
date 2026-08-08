import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MfaPolicy, MfaPolicyDocument } from './mfa-policy.schema';

@Injectable()
export class MfaPolicyService {
  constructor(
    @InjectModel(MfaPolicy.name) private policyModel: Model<MfaPolicyDocument>,
  ) {}

  async getPolicy() {
    const policy = await this.policyModel.findOne({ key: 'global' }).lean();
    // Secure default: MFA remains required until a superadmin explicitly turns it off.
    return { enabled: policy?.enabled !== false };
  }

  async updatePolicy(enabled: boolean, actorId: string) {
    const policy = await this.policyModel.findOneAndUpdate(
      { key: 'global' },
      {
        $set: {
          enabled,
          updatedBy: new Types.ObjectId(actorId),
        },
        $setOnInsert: { key: 'global' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { enabled: policy.enabled };
  }
}
