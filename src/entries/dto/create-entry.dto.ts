import { IsArray, IsDateString, IsIn, IsNotEmpty, IsNumber, IsString, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class CreateEntryDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsDateString()
  date: string;

  @IsArray()
  @ArrayMinSize(10)
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  field1Boxes: number[];

  @IsIn(['+', '-', '*', '/'])
  operator1: string;

  @IsArray()
  @ArrayMinSize(6)
  @ArrayMaxSize(6)
  @IsNumber({}, { each: true })
  field2Boxes: number[];

  @IsIn(['+', '-', '*', '/'])
  operator2: string;

  @IsIn(['+', '-', '*', '/'])
  operator3: string;
}
