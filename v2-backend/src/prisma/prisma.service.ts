import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      // Emit logs depending on environment context for Observability
      log: ['error', 'warn'],
    });
  }

  async onModuleInit() {
    // Explicitly establish connection on startup to avoid cold-start delays
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
