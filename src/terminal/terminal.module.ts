import { Module } from '@nestjs/common';
import { SshGateway } from './ssh.gateway';
import { RdpGateway } from './rdp.gateway';
import { RdpService } from './rdp.service';
import { MachinesModule } from '../machines/machines.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '../config/config.module';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { SshModule } from './ssh.module';

@Module({
  imports: [
    MachinesModule,
    JwtModule,
    ConfigModule,
    RbacModule,
    AuthModule,
    AuditModule,
    SshModule,
  ],
  providers: [SshGateway, RdpGateway, RdpService],
})
export class TerminalModule {}
