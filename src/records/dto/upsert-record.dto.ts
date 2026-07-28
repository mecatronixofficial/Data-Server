import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsMongoId, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class RecordFieldAssignmentDto {
  @IsMongoId()
  fieldId: string;

  @IsMongoId()
  userId: string;
}

export class UpsertRecordDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecordFieldAssignmentDto)
  fields: RecordFieldAssignmentDto[];

  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  adminIds: string[];
}
