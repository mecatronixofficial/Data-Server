import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = getAllowedOrigins();

  app.use(cookieParser());

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
      transform: true,
    }),
  );

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
