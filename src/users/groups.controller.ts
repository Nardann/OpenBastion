import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GroupsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @SkipThrottle()
  @Roles(Role.ADMIN)
  findAll() {
    return this.prisma.group.findMany({
      include: {
        users: {
          select: { id: true, email: true, username: true },
        },
        _count: {
          select: { users: true },
        },
      },
    });
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() data: { name: string; description?: string }) {
    return this.prisma.group.create({ data });
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() data: { name?: string; description?: string },
  ) {
    return this.prisma.group.update({
      where: { id },
      data,
    });
  }

  @Post(':id/users')
  @Roles(Role.ADMIN)
  addUser(@Param('id') id: string, @Body() data: { userId: string }) {
    return this.prisma.group.update({
      where: { id },
      data: {
        users: {
          connect: { id: data.userId },
        },
      },
    });
  }

  @Delete(':id/users/:userId')
  @Roles(Role.ADMIN)
  removeUser(@Param('id') id: string, @Param('userId') userId: string) {
    return this.prisma.group.update({
      where: { id },
      data: {
        users: {
          disconnect: { id: userId },
        },
      },
    });
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.prisma.group.delete({ where: { id } });
  }
}
