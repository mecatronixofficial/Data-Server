import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ICON_KEYS } from '../icon-keys';

export class UpdateFinalTotalSettingsDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsIn([...ICON_KEYS, ''])
  icon?: string;

  @IsOptional()
  @IsIn(['add', 'subtract'])
  sign?: 'add' | 'subtract';
}
