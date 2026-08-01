import { IsNotEmpty, IsString } from 'class-validator';

export class StartNewEntryDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}
