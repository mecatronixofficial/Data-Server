import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { MongoIdPipe } from '../common/mongo-id.pipe';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('manageUsers')
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersService.create(dto, req.user.sub);
  }

  @Put(':id')
  updateProfile(@Param('id', MongoIdPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.usersService.updateProfile(id, dto);
  }

  @Put(':id/password')
  resetPassword(@Param('id', MongoIdPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(id, dto.password);
  }

  @Put(':id/mfa/reset')
  resetMfa(@Param('id', MongoIdPipe) id: string, @Req() req: any) {
    return this.usersService.resetMfa(id, req.user.sub);
  }

  @Put(':id/status')
  setActive(@Param('id', MongoIdPipe) id: string, @Body() dto: UpdateStatusDto, @Req() req: any) {
    return this.usersService.setActive(id, dto.isActive, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id', MongoIdPipe) id: string, @Req() req: any) {
    return this.usersService.remove(id, req.user.sub);
  }
}
