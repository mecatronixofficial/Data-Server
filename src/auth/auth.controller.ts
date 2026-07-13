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
import { randomBytes, timingSafeEqual } from 'crypto';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  private frontendUrl() {
    const configured =
      process.env.FRONTEND_URL ||
      process.env.FRONTEND_ORIGIN ||
      process.env.FRONTEND_ORIGINS?.split(',')[0] ||
      'http://localhost:3000';
    return configured.trim().replace(/\/$/, '');
  }

  private googleCallbackUrl() {
    const callbackUrl = (
      process.env.GOOGLE_CALLBACK_URL ||
      `${this.frontendUrl()}/api/auth/google/callback`
    );

    return callbackUrl.trim().replace(/\/$/, '');
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

  @Get('google')
  google(@Res() res: Response) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      return res.redirect(`${this.frontendUrl()}/login?oauth_error=not_configured`);
    }

    const state = randomBytes(32).toString('hex');
    res.cookie(
      'google_oauth_state',
      state,
      this.authService.cookieOptions(10 * 60 * 1000),
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.googleCallbackUrl(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });

    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const query = req.query as Record<string, string | undefined>;
    const savedState = req.cookies?.['google_oauth_state'];
    res.clearCookie('google_oauth_state', { path: '/' });

    if (
      !query.code ||
      !query.state ||
      !savedState ||
      query.state.length !== savedState.length ||
      !timingSafeEqual(Buffer.from(query.state), Buffer.from(savedState))
    ) {
      return res.redirect(`${this.frontendUrl()}/login?oauth_error=invalid_state`);
    }

    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uri: this.googleCallbackUrl(),
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) throw new Error('Google token exchange failed');
      const tokens = (await tokenResponse.json()) as { access_token?: string };
      if (!tokens.access_token) throw new Error('Google access token missing');

      const profileResponse = await fetch(
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      );
      if (!profileResponse.ok) throw new Error('Google profile request failed');

      const profile = (await profileResponse.json()) as {
        email?: string;
        email_verified?: boolean;
      };
      if (!profile.email || profile.email_verified !== true) {
        throw new Error('Google email is not verified');
      }

      const user = await this.authService.validateGoogleUser(profile.email);
      const { accessToken, refreshToken } = await this.authService.signTokens(user);
      this.setAuthCookies(res, accessToken, refreshToken);
      return res.redirect(`${this.frontendUrl()}/dashboard`);
    } catch {
      return res.redirect(`${this.frontendUrl()}/login?oauth_error=access_denied`);
    }
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
