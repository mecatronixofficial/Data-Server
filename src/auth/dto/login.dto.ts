import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  // Kept as `email` for API compatibility; accepts an email address or user id.
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email: string;

  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(72)
  password: string;
}
