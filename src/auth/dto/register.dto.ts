import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export const ALLOWED_REGISTER_ROLES = [
  'tenant',
  'property-owner',
  'landlord',
] as const;

export class RegisterDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(7)
  phone!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsIn(ALLOWED_REGISTER_ROLES)
  role?: string;
}
