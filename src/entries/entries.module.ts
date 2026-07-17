import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Entry, EntrySchema } from './entry.schema';
import { BoxNames, BoxNamesSchema } from './box-names.schema';
import { EntriesService } from './entries.service';
import { EntriesController } from './entries.controller';
import { JwtSharedModule } from '../auth/jwt-shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Entry.name, schema: EntrySchema },
      { name: BoxNames.name, schema: BoxNamesSchema },
    ]),
    JwtSharedModule,
  ],
  providers: [EntriesService],
  controllers: [EntriesController],
})
export class EntriesModule {}
