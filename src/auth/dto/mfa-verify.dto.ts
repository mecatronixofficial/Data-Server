import { IsString, Length, MaxLength } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @Length(20, 4096)
  challengeToken: string;

  @IsString()
  @Length(6, 32)
  code: string;
}
