import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ICON_KEYS } from '../icon-keys';

export class UpdateFinalTotalSettingsDto {
  @IsNotEmpty()
  @IsString()
  label: string;

  @IsOptional()
  @IsIn([...ICON_KEYS, ''])
  icon?: string;

  @IsOptional()
  @IsIn(['add', 'subtract'])
  sign?: 'add' | 'subtract';
}
