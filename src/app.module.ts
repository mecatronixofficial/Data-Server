import { Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EntriesModule } from './entries/entries.module';
import { FieldsModule } from './fields/fields.module';
import { RecordsModule } from './records/records.module';
import { ReportSettingsModule } from './report-settings/report-settings.module';
import { configureMongoSrvDns } from './mongo-dns';
import { HealthController } from './health.controller';

const nodeEnv = process.env.NODE_ENV || 'development';
let developmentMemoryServer: { stop(): Promise<boolean> } | undefined;

async function getMongoUri() {
  const configuredUri = process.env.MONGODB_URI;

  if (configuredUri) {
    configureMongoSrvDns(configuredUri);
    return configuredUri;
  }

  if (nodeEnv === 'production') {
    throw new Error('MONGODB_URI is required in the production environment');
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const memoryServer = await MongoMemoryServer.create();
  developmentMemoryServer = memoryServer;
  return memoryServer.getUri();
}

function validateEnvironment(config: Record<string, unknown>) {
  const environment = String(config.NODE_ENV || nodeEnv);
  const port = Number(config.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  if (environment !== 'production') return config;

  const required = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !String(config[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  const accessSecret = String(config.JWT_ACCESS_SECRET);
  const refreshSecret = String(config.JWT_REFRESH_SECRET);
  if (accessSecret.length < 32 || refreshSecret.length < 32) {
    throw new Error('JWT secrets must each contain at least 32 characters');
  }
  if (accessSecret === refreshSecret) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (/replace|change.?me|example|secret/i.test(accessSecret + refreshSecret)) {
    throw new Error('Replace the example JWT secrets before starting production');
  }
  const mongoUri = String(config.MONGODB_URI);
  if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_URI must use the mongodb:// or mongodb+srv:// protocol');
  }
  const configuredOrigins = String(
    config.FRONTEND_ORIGINS || config.FRONTEND_ORIGIN || '',
  ).split(',').map((origin) => origin.trim()).filter(Boolean);
  if (configuredOrigins.length === 0) {
    throw new Error('FRONTEND_ORIGINS is required in production');
  }
  for (const origin of configuredOrigins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`Invalid frontend origin: ${origin}`);
    }
  }
  for (const key of ['JWT_ACCESS_EXPIRES', 'JWT_REFRESH_EXPIRES']) {
    if (config[key] && !/^\d+(ms|s|m|h|d)$/i.test(String(config[key]))) {
      throw new Error(`${key} must use a duration such as 15m or 7d`);
    }
  }
  for (const key of ['MONGODB_MAX_POOL_SIZE', 'MONGODB_MIN_POOL_SIZE']) {
    if (config[key] !== undefined && (!Number.isInteger(Number(config[key])) || Number(config[key]) < 0)) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  if (config.COMPRESSION_THRESHOLD_BYTES !== undefined) {
    const threshold = Number(config.COMPRESSION_THRESHOLD_BYTES);
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('COMPRESSION_THRESHOLD_BYTES must be a non-negative number');
    }
  }
  const maxPoolSize = Number(config.MONGODB_MAX_POOL_SIZE || 20);
  const minPoolSize = Number(config.MONGODB_MIN_POOL_SIZE || 1);
  if (maxPoolSize < 1 || minPoolSize > maxPoolSize) {
    throw new Error('MongoDB pool sizes must satisfy 0 <= minimum <= maximum and maximum >= 1');
  }
  if (config.COOKIE_SECURE !== undefined && String(config.COOKIE_SECURE) !== 'true') {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        nodeEnv === 'production'
          ? ['.env.production']
          : [`.env.${nodeEnv}`, '.env'],
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      useFactory: async () => ({
        uri: await getMongoUri(),
        retryAttempts: 3,
        retryDelay: 1000,
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 20),
        minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 1),
      }),
    }),
    AuthModule,
    UsersModule,
    FieldsModule,
    RecordsModule,
    EntriesModule,
    ReportSettingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    if (developmentMemoryServer) {
      await developmentMemoryServer.stop();
      developmentMemoryServer = undefined;
    }
  }
}
