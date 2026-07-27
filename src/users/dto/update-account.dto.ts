import { IsEmail, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateAccountDto {
  @IsOptional()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
