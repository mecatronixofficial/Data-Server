import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ICON_KEYS } from '../icon-keys';
import { COLOR_KEYS } from '../color-keys';

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

  @IsOptional()
  @IsArray()
  @IsIn([...COLOR_KEYS, ''], { each: true })
  boxColors?: string[];

  // Inner-field columns per box, parallel to boxNames. Shape is validated/sanitized
  // (and defaulted to Name/Value when empty) in FieldsService.normalize().
  @IsOptional()
  @IsArray()
  boxFields?: Array<Array<{
    label: string;
    type: string;
    auto?: string;
    constant?: number;
    sumTotal?: boolean;
    sumSign?: string;
    formula?: { op: string; a: string; b: string };
  }>>;

  // Specific user/admin accounts allowed to see this field. Empty means hidden from everyone.
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  visibleUserIds?: string[];

  // When true, only 'user' accounts can edit this field on an entry; 'admin' sees it
  // read-only. When false (default), only 'admin' can edit it.
  @IsOptional()
  @IsBoolean()
  userOnlyEdit?: boolean;
}
