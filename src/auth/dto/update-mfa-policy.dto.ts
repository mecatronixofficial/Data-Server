import { IsBoolean, IsOptional, Matches } from 'class-validator';

export class UpdateMfaPolicyDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Authenticator code must contain exactly 6 digits' })
  code?: string;
}
