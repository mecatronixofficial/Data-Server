import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';

export class RecordFieldAssignmentDto {
  @IsMongoId()
  fieldId: string;

  @IsMongoId()
  userId: string;
}

export class UpsertRecordDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecordFieldAssignmentDto)
  fields: RecordFieldAssignmentDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  adminIds: string[];
}
