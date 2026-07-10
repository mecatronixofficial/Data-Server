import {
  Controller,
  Post,
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
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    const { accessToken, refreshToken } = await this.authService.signTokens(user);

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
  me(@Req() req: any) {
    return req.user;
  }
}
