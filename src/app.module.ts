import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EntriesModule } from './entries/entries.module';
import { FieldsModule } from './fields/fields.module';
import { RecordsModule } from './records/records.module';
import { ReportSettingsModule } from './report-settings/report-settings.module';
import { configureMongoSrvDns } from './mongo-dns';

const nodeEnv = process.env.NODE_ENV || 'development';

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
  return memoryServer.getUri();
}

function validateEnvironment(config: Record<string, unknown>) {
  const environment = String(config.NODE_ENV || nodeEnv);
  if (environment !== 'production') return config;

  const required = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
  const missing = required.filter((key) => !String(config[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
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
        retryAttempts: 1,
        retryDelay: 1000,
      }),
    }),
    AuthModule,
    UsersModule,
    FieldsModule,
    RecordsModule,
    EntriesModule,
    ReportSettingsModule,
  ],
})
export class AppModule {}
