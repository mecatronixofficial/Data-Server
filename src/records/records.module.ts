import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecordEntry, RecordEntrySchema } from './record.schema';
import { Field, FieldSchema } from '../fields/field.schema';
import { User, UserSchema } from '../users/user.schema';
import { RecordsService } from './records.service';
import { RecordsController } from './records.controller';
import { JwtSharedModule } from '../auth/jwt-shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecordEntry.name, schema: RecordEntrySchema },
      { name: Field.name, schema: FieldSchema },
      { name: User.name, schema: UserSchema },
    ]),
    JwtSharedModule,
  ],
  providers: [RecordsService],
  controllers: [RecordsController],
})
export class RecordsModule {}
