import { Module } from '@nestjs/common';
import { SshService } from './ssh.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SshService],
  exports: [SshService],
})
export class SshModule {}
