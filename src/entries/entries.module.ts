import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Entry, EntrySchema } from './entry.schema';
import { EntriesService } from './entries.service';
import { EntriesController } from './entries.controller';
import { JwtSharedModule } from '../auth/jwt-shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Entry.name, schema: EntrySchema }]),
    JwtSharedModule,
  ],
  providers: [EntriesService],
  controllers: [EntriesController],
})
export class EntriesModule {}
