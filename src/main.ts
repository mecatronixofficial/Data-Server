import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { createHash } from 'crypto';
import { json, NextFunction, Request, Response, urlencoded } from 'express';
import { AppModule } from './app.module';

function getAllowedOrigins(): Set<string> {
  const configuredOrigins =
    process.env.FRONTEND_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    'http://localhost:3000';

  const origins = configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const url = new URL(origin);

      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
        throw new Error(
          `Invalid CORS origin "${origin}". Use only the origin, for example https://app.example.com`,
        );
      }

      return url.origin;
    });

  if (origins.length === 0) {
    throw new Error('At least one frontend origin must be configured');
  }

  return new Set(origins);
}

type LoginAttempt = { count: number; resetAt: number };
const loginAttempts = new Map<string, LoginAttempt>();
const mfaAttempts = new Map<string, LoginAttempt>();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const allowedOrigins = getAllowedOrigins();
  const isProduction = process.env.NODE_ENV === 'production';

  app.getHttpAdapter().getInstance().disable('x-powered-by');
  if (isProduction) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(json({ limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));
  app.use(urlencoded({ extended: false, limit: process.env.REQUEST_BODY_LIMIT || '1mb' }));

  app.use(cookieParser());

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST' || req.path !== '/auth/login') return next();
    const now = Date.now();
    const identifier = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const key = `${req.ip}|${identifier}`;
    const current = loginAttempts.get(key);
    const attempt = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + 15 * 60_000 }
      : current;
    if (attempt.count >= 10) {
      res.setHeader('Retry-After', String(Math.ceil((attempt.resetAt - now) / 1000)));
      return res.status(429).json({
        statusCode: 429,
        message: 'Too many login attempts. Please try again later.',
      });
    }
    attempt.count += 1;
    loginAttempts.set(key, attempt);
    if (loginAttempts.size > 10_000) {
      const oldestKey = loginAttempts.keys().next().value;
      if (oldestKey) loginAttempts.delete(oldestKey);
    }
    res.on('finish', () => {
      if (res.statusCode < 400) loginAttempts.delete(key);
    });
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST' || req.path !== '/auth/mfa/verify') return next();
    const now = Date.now();
    const challenge = typeof req.body?.challengeToken === 'string' ? req.body.challengeToken : '';
    const challengeKey = createHash('sha256').update(challenge).digest('hex');
    const key = `${req.ip}|${challengeKey}`;
    const current = mfaAttempts.get(key);
    const attempt = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + 10 * 60_000 }
      : current;
    if (attempt.count >= 10) {
      res.setHeader('Retry-After', String(Math.ceil((attempt.resetAt - now) / 1000)));
      return res.status(429).json({
        statusCode: 429,
        message: 'Too many verification attempts. Sign in again later.',
      });
    }
    attempt.count += 1;
    mfaAttempts.set(key, attempt);
    if (mfaAttempts.size > 10_000) {
      const oldestKey = mfaAttempts.keys().next().value;
      if (oldestKey) mfaAttempts.delete(oldestKey);
    }
    res.on('finish', () => {
      if (res.statusCode < 400) mfaAttempts.delete(key);
    });
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const origin = req.get('origin');
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (origin && isMutation && !allowedOrigins.has(origin)) {
      return res.status(403).json({
        statusCode: 403,
        message: 'Request origin is not allowed',
      });
    }
    next();
  });

  app.enableCors({
    origin: (origin, callback) => {
      // Requests without Origin are not cross-origin browser requests.
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 4000;
  app.enableShutdownHooks();
  await app.listen(port);
  console.log(`Beone Production backend listening on port ${port}`);
}
bootstrap().catch((error) => {
  console.error('Backend failed to start', error);
  process.exit(1);
});
