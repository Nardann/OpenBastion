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
import { SessionRecorderService } from './recording/session-recorder.service';
import { RecordingController } from './recording/recording.controller';
import { RecordingCleanupService } from './recording/recording-cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MachinesModule,
    JwtModule,
    ConfigModule,
    RbacModule,
    AuthModule,
    AuditModule,
    SshModule,
    PrismaModule,
    SettingsModule,
    UsersModule,
  ],
  providers: [SshGateway, RdpGateway, RdpService, SessionRecorderService, RecordingCleanupService],
  controllers: [RecordingController],
})
export class TerminalModule {}
