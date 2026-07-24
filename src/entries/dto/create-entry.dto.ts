import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class EntryFieldInputDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  boxes: number[];

  @IsOptional()
  @IsArray()
  details?: Array<Array<{ name: string; value: number }>>;

  // Only meaningful for fields whose calculation role is 'grouped'; ignored otherwise.
  @IsOptional()
  @IsIn(['+', '-', '*', '/'])
  operator?: string;
}

export class CreateEntryDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EntryFieldInputDto)
  fields: EntryFieldInputDto[];

  @IsArray()
  @IsIn(['+', '-', '*', '/'], { each: true })
  fieldOperators: string[];
}
