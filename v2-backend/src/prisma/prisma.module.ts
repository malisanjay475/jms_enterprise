import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 10/10 Enterprise Practice: Make Prisma globally accessible 
 * so it isn't repeatedly injected across every sub-module manually.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
