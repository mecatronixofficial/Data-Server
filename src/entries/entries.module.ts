import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Entry, EntrySchema } from './entry.schema';
import { EntriesService } from './entries.service';
import { EntriesController } from './entries.controller';
import { JwtSharedModule } from '../auth/jwt-shared.module';
import { FieldsModule } from '../fields/fields.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Entry.name, schema: EntrySchema }]),
    JwtSharedModule,
    FieldsModule,
    UsersModule,
  ],
  providers: [EntriesService],
  controllers: [EntriesController],
})
export class EntriesModule {}
