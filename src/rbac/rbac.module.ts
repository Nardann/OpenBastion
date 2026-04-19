import { Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PermissionsController } from './permissions.controller';
import { RbacGuard } from './rbac.guard';

@Module({
  imports: [PrismaModule],
  providers: [RbacService, RbacGuard],
  controllers: [PermissionsController],
  exports: [RbacService, RbacGuard],
})
export class RbacModule {}
