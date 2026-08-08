import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class UpdateReportSettingsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  visibleColumns: string[];
}
