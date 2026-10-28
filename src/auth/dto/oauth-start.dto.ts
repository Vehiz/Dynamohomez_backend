import { IsOptional, IsString } from 'class-validator';

export class OAuthStartDto {
  @IsOptional()
  @IsString()
  redirectTo?: string;
}
