import { IsEmail, IsIn, IsMongoId, IsNotEmpty, MinLength, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @MinLength(6)
  password: string;

  @IsIn(['user', 'admin', 'superadmin'])
  role: string;

  @ValidateIf((o) => o.role === 'user')
  @IsMongoId()
  assignedAdminId?: string;
}
