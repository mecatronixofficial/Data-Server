import { IsBoolean } from 'class-validator';

export class UpdateMfaPolicyDto {
  @IsBoolean()
  enabled: boolean;
}
