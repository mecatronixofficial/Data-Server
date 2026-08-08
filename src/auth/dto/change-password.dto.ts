import { IsNotEmpty, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsNotEmpty()
  @MaxLength(72)
  currentPassword: string;

  @MinLength(12)
  @MaxLength(72)
  newPassword: string;
}
