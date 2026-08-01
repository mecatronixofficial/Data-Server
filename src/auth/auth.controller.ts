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
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
    private usersService: UsersService,
  ) {}

  private frontendUrl() {
    const configured =
      process.env.FRONTEND_URL ||
      process.env.FRONTEND_ORIGIN ||
      process.env.FRONTEND_ORIGINS?.split(',')[0] ||
      'http://localhost:3000';
    return configured.trim().replace(/\/$/, '');
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    res.cookie(
      'access_token',
      accessToken,
      this.authService.cookieOptions(5 * 60 * 60 * 1000),
    );
    res.cookie(
      'refresh_token',
      refreshToken,
      this.authService.cookieOptions(7 * 24 * 60 * 60 * 1000),
    );
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    const { accessToken, refreshToken } = await this.authService.signTokens(user);

    this.setAuthCookies(res, accessToken, refreshToken);

    return {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/' });
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
      const { accessToken } = await this.authService.signTokens({
        _id: payload.sub,
        name: payload.name,
        role: payload.role,
      });
      res.cookie(
        'access_token',
        accessToken,
        this.authService.cookieOptions(5 * 60 * 60 * 1000),
      );
      return { message: 'Refreshed' };
    } catch {
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
      name: user.name,
      email: user.email,
      role: user.role,
      assignedAdminId: user.assignedAdminId,
      teamName: reportContext?.teamName || user.teamName,
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
