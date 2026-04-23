import { Module } from '@nestjs/common';
import { MachinesService } from './machines.service';
import { MachinesController } from './machines.controller';
import { MachineGroupsService } from './machine-groups.service';
import { MachineGroupsController } from './machine-groups.controller';
import { RbacModule } from '../rbac/rbac.module';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultModule } from '../vault/vault.module';
import { SshModule } from '../terminal/ssh.module';

@Module({
  imports: [RbacModule, PrismaModule, VaultModule, SshModule],
  providers: [MachinesService, MachineGroupsService],
  controllers: [MachinesController, MachineGroupsController],
  exports: [MachinesService, MachineGroupsService],
})
export class MachinesModule {}
