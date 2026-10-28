import { Body, Controller, Delete, HttpCode, HttpStatus, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OAuthStartDto } from './dto/oauth-start.dto';
import { JwtAuthGuard } from './jwt.guard';
import { UpdateRolesDto } from './dto/update-roles.dto';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService)
    private readonly authService: AuthService,
  ) {}

  @Post('register')
  async register(@Body() payload: RegisterDto) {
    const data = await this.authService.register(payload);
    return { success: true, data };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() payload: LoginDto) {
    const data = await this.authService.login(payload);
    return { success: true, data };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() payload: RefreshTokenDto) {
    const data = await this.authService.refresh(payload);
    return { success: true, data };
  } 

  @Post('logout')
  @HttpCode(200)
  async logout(@Body() payload: RefreshTokenDto) {
    const data = await this.authService.logout(payload);
    return { success: true, data };
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() payload: ForgotPasswordDto) {
    const data = await this.authService.requestPasswordReset(payload.email);
    return { success: true, data };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() payload: ResetPasswordDto) {
    const data = await this.authService.resetPassword(payload.resetToken, payload.password);
    return { success: true, data };
  }

  @Post('oauth/google/start')
  @HttpCode(200)
  async googleOAuthStart(@Body() payload: OAuthStartDto) {
    const data = await this.authService.getGoogleOAuthStartUrl(payload.redirectTo);
    return { success: true, data };
  }

  @Patch('account/roles')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateAccountRoles(@Req() req: Request, @Body() payload: UpdateRolesDto) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.authService.updateAccountRoles(userId, payload.roles, payload.primaryRole);
    return { success: true, data };
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteAccount(@Req() req: Request) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.authService.deleteAccount(userId);
    return { success: true, data };
  }
}
