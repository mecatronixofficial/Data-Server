import {
  Controller,
  Post,
  Put,
  Body,
  Res,
  Req,
  Get,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    res.cookie(
      'access_token',
      accessToken,
      this.authService.cookieOptions(this.authService.accessCookieMaxAge()),
    );
    res.cookie(
      'refresh_token',
      refreshToken,
      this.authService.cookieOptions(this.authService.refreshCookieMaxAge()),
    );
  }

  private clearAuthCookies(res: Response) {
    const options = this.authService.cookieOptions();
    res.clearCookie('access_token', options);
    res.clearCookie('refresh_token', options);
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    this.clearAuthCookies(res);
    return this.authService.beginMfaLogin(user);
  }

  @Post('mfa/verify')
  async verifyMfa(@Body() dto: MfaVerifyDto, @Res({ passthrough: true }) res: Response) {
    const { user, recoveryCodes } = await this.authService.verifyMfa(
      dto.challengeToken,
      dto.code,
    );
    const { accessToken, refreshToken } = await this.authService.signTokens(user);
    this.setAuthCookies(res, accessToken, refreshToken);
    return {
      id: user._id,
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      mfaEnabled: true,
      ...(recoveryCodes ? { recoveryCodes } : {}),
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    this.clearAuthCookies(res);
    return { message: 'Logged out' };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refresh_token'];
    if (!token) throw new UnauthorizedException('No refresh token');

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      if (payload.tokenType !== 'refresh' || payload.mfaVerified !== true) {
        throw new Error('Invalid token type');
      }
      const user = await this.usersService.findById(payload.sub);
      if (user.isActive === false) throw new Error('Account is inactive');
      if (user.mfaEnabled !== true) throw new Error('MFA enrollment required');
      const { accessToken, refreshToken } = await this.authService.signTokens(user);
      this.setAuthCookies(res, accessToken, refreshToken);
      return { message: 'Refreshed' };
    } catch {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token invalid or expired');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const user = await this.usersService.findById(req.user.sub);
    const reportContext = user.role === 'superadmin'
      ? null
      : await this.usersService.getReportContext(user.id).catch(() => null);
    return {
      id: user._id,
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      assignedAdminId: user.assignedAdminId,
      teamName: reportContext?.teamName || user.teamName,
      mfaEnabled: user.mfaEnabled === true,
      permissions: req.user.permissions,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Put('me')
  async updateProfile(
    @Req() req: any,
    @Body() dto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const updated = await this.usersService.updateProfile(req.user.sub, dto);
    const { accessToken, refreshToken } = await this.authService.signTokens(updated);
    this.setAuthCookies(res, accessToken, refreshToken);

    return {
      id: updated._id,
      userId: updated.userId,
      name: updated.name,
      email: updated.email,
      role: updated.role,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Put('me/password')
  async changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeOwnPassword(
      req.user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
