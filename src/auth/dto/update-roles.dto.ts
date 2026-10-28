import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roles!: string[];

  @IsOptional()
  @IsString()
  primaryRole?: string;
}
