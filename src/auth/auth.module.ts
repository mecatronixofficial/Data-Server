import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtSharedModule } from './jwt-shared.module';

@Module({
  imports: [UsersModule, JwtSharedModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtSharedModule],
})
export class AuthModule {}
