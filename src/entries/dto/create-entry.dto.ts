import { IsArray, IsDateString, IsIn, IsNotEmpty, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class CreateEntryDto {
  @IsNotEmpty()
  name: string;

  @IsDateString()
  date: string;

  @IsArray()
  @ArrayMinSize(10)
  @ArrayMaxSize(10)
  field1Boxes: number[];

  @IsIn(['+', '-', '*', '/'])
  operator1: string;

  @IsArray()
  @ArrayMinSize(6)
  @ArrayMaxSize(6)
  field2Boxes: number[];

  @IsIn(['+', '-', '*', '/'])
  operator2: string;

  @IsIn(['+', '-', '*', '/'])
  operator3: string;
}
