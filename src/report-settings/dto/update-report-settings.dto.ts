import { IsArray, IsString } from 'class-validator';

export class UpdateReportSettingsDto {
  @IsArray()
  @IsString({ each: true })
  visibleColumns: string[];
}
