import { IsEmail, IsIn, IsMongoId, IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(120)
  name: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9._-]{2,31}$/, {
    message: 'User ID must start with a letter and contain 3-32 letters, numbers, dots, underscores, or hyphens',
  })
  userId: string;

  @MinLength(12)
  @MaxLength(72)
  password: string;

  @IsIn(['user', 'admin', 'superadmin'])
  role: string;

  @ValidateIf((o) => o.role === 'user')
  @IsMongoId()
  assignedAdminId?: string;

  @ValidateIf((o) => o.role === 'admin')
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  teamName?: string;
}
