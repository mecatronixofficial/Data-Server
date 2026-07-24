import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EntriesModule } from './entries/entries.module';
import { FieldsModule } from './fields/fields.module';
import { configureMongoSrvDns } from './mongo-dns';

const nodeEnv = process.env.NODE_ENV || 'development';

async function getMongoUri() {
  const configuredUri = process.env.MONGODB_URI;

  if (configuredUri) {
    try {
      configureMongoSrvDns(configuredUri);
      await mongoose.connect(configuredUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await mongoose.disconnect();
      return configuredUri;
    } catch (error) {
      console.warn(`Configured MongoDB URI is unavailable. Falling back to local MongoDB. ${error}`);
    }
  }

  const memoryServer = await MongoMemoryServer.create();
  return memoryServer.getUri();
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        nodeEnv === 'production'
          ? ['.env.production']
          : [`.env.${nodeEnv}`, '.env'],
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
    EntriesModule,
  ],
})
export class AppModule {}
