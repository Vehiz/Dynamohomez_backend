import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(16)
  resetToken!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}