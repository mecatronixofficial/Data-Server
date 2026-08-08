import { MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @MinLength(12)
  @MaxLength(72)
  password: string;
}
