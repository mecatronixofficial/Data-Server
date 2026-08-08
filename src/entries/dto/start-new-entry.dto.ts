import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartNewEntryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;
}
