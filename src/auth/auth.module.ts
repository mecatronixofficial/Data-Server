import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtSharedModule } from './jwt-shared.module';
import { MongooseModule } from '@nestjs/mongoose';
import { MfaPolicy, MfaPolicySchema } from './mfa-policy.schema';
import { MfaPolicyService } from './mfa-policy.service';

@Module({
  imports: [
    UsersModule,
    JwtSharedModule,
    MongooseModule.forFeature([{ name: MfaPolicy.name, schema: MfaPolicySchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, MfaPolicyService],
  exports: [JwtSharedModule],
})
export class AuthModule {}
