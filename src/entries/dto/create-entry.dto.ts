import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EntryFieldInputDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsNumber({ allowInfinity: false, allowNaN: false }, { each: true })
  @Min(-1_000_000_000_000, { each: true })
  @Max(1_000_000_000_000, { each: true })
  boxes: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  details?: Array<Array<Record<string, string | number>>>;

  // Only meaningful for fields whose calculation role is 'grouped'; ignored otherwise.
  @IsOptional()
  @IsIn(['+', '-', '*', '/'])
  operator?: string;
}

// Update requests may identify only the boxes edited in this browser. The
// server then merges those boxes into the latest document instead of replacing
// newer values saved from another phone, laptop, or browser tab.
export class EntryFieldChangeDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(199, { each: true })
  boxIndexes: number[];
}

export class CreateEntryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @IsDateString()
  date: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => EntryFieldInputDto)
  fields: EntryFieldInputDto[];

  // Omitted by older clients, which retain full-payload behavior. New clients
  // include it even on first save so a concurrent create can merge safely.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((change: EntryFieldChangeDto) => change.name)
  @ValidateNested({ each: true })
  @Type(() => EntryFieldChangeDto)
  changedFields?: EntryFieldChangeDto[];

  @IsOptional()
  @IsBoolean()
  dateChanged?: boolean;
}
