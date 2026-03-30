import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SyncController } from './sync.controller';
import { SyncProducerService } from './sync.producer';
import { SyncProcessor } from './sync.processor';

@Module({
  imports: [
    // Register the precise Redis-backed Bull queue for our local offline operations
    BullModule.registerQueue({
      name: 'local-sync-queue',
      defaultJobOptions: {
        removeOnComplete: 1000, 
        removeOnFail: 5000,    // Keep failed jobs in Redis memory to inspect DLQs
      },
    }),
  ],
  controllers: [SyncController], // The VPS Endpoint
  providers: [SyncProducerService, SyncProcessor], 
  exports: [SyncProducerService], // Allow other features (like Production) to push jobs to the sync engine
})
export class SyncModule {}
