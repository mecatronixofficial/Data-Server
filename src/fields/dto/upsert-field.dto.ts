import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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

  // This field's own accent color — separate from, and never applied to, the icon above.
  @IsOptional()
  @IsIn([...COLOR_KEYS, ''])
  color?: string;

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

  // When true, only 'user' accounts can edit this field on an entry; 'admin' sees it
  // read-only. When false (default), only 'admin' can edit it.
  @IsOptional()
  @IsBoolean()
  userOnlyEdit?: boolean;

  // Account ids (user/admin) allowed to see this field. Empty/omitted = visible to
  // everyone. Sanitized against real accounts in FieldsService.normalize().
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleTo?: string[];
}
