import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Param,
  Patch,
  Delete,
  Req,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import {
  CreateUserDto,
  UpdateUserDto,
  UpdateMeDto,
} from '../common/dto/security.dto';
import { AuditService, AuditCategory } from '../audit/audit.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @SkipThrottle()
  @Roles(Role.ADMIN)
  async findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @Patch('me')
  async updateMe(@Req() req: any, @Body() body: UpdateMeDto) {
    const result = await this.usersService.update(req.user.sub, body);

    await this.auditService.logAction(
      req.user.sub,
      'USER: PROFILE_UPDATED',
      { fields: Object.keys(body) },
      req.user.authMethod,
      req.ip,
      AuditCategory.USER,
    );

    return result;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @Req() req: any,
  ) {
    const result = await this.usersService.update(id, body);

    await this.auditService.logAction(
      req.user.sub,
      'USER: ADMIN_UPDATED_USER',
      { targetUserId: id, fields: Object.keys(body) },
      req.user.authMethod,
      req.ip,
      AuditCategory.USER,
    );

    return result;
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    if (id === req.user.sub) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    const result = await this.usersService.remove(id);

    await this.auditService.logAction(
      req.user.sub,
      'USER: DELETED',
      { targetUserId: id, email: result.email },
      req.user.authMethod,
      req.ip,
      AuditCategory.USER,
    );

    return result;
  }

  @Post('me/revoke-tokens')
  async revokeMyTokens(@Req() req: any) {
    const result = await this.usersService.revokeAllTokens(req.user.sub);

    await this.auditService.logAction(
      req.user.sub,
      'AUTH: SELF_TOKEN_REVOCATION',
      { userId: req.user.sub },
      req.user.authMethod,
      req.ip,
      AuditCategory.AUTH,
    );

    return result;
  }

  @Post(':id/disable-otp')
  @Roles(Role.ADMIN)
  async disableUserOtp(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const result = await this.usersService.update(id, {
      isOtpEnabled: false,
      otpSecret: null,
    });

    await this.auditService.logAction(
      req.user.sub,
      'AUTH: ADMIN_OTP_DISABLED',
      { targetUserId: id },
      req.user.authMethod,
      req.ip,
      AuditCategory.AUTH,
    );

    return result;
  }

  @Post(':id/revoke-tokens')
  @Roles(Role.ADMIN)
  async revokeTokens(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const result = await this.usersService.revokeAllTokens(id);

    await this.auditService.logAction(
      req.user.sub,
      'AUTH: ADMIN_TOKEN_REVOCATION',
      { targetUserId: id },
      req.user.authMethod,
      req.ip,
      AuditCategory.AUTH,
    );

    return result;
  }
}
