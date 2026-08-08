import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ReportQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startDate?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endDate?: string;

  @IsOptional()
  @IsIn(['mine', 'team', 'all'])
  scope?: 'mine' | 'team' | 'all';

  @IsOptional()
  @IsIn(['admin', 'user'])
  ownerRole?: 'admin' | 'user';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  teamName?: string;
}
