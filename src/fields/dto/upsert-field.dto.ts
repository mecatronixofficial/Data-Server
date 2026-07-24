import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ICON_KEYS } from '../icon-keys';

export class UpsertFieldDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  boxNames: string[];

  @IsOptional()
  @IsIn(['grouped', 'signed'])
  calcType?: 'grouped' | 'signed';

  @IsOptional()
  @IsInt()
  groupSplit?: number;

  @IsOptional()
  @IsIn([...ICON_KEYS, ''])
  icon?: string;

  @IsOptional()
  @IsArray()
  @IsIn([...ICON_KEYS, ''], { each: true })
  boxIcons?: string[];
}
