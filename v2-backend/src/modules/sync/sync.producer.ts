import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncAction } from '@prisma/client';

@Injectable()
export class SyncProducerService {
  private readonly logger = new Logger(SyncProducerService.name);

  constructor(
    @InjectQueue('local-sync-queue') private readonly syncQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Called automatically by Prisma Middlewares or directly in Services
   * whenever a record (e.g., JobCard) is inserted/updated locally.
   */
  async enqueueSyncRecord(params: {
    factoryId: number;
    tableName: string;
    recordId: string;
    action: SyncAction;
    rowData: any;
    version: number;
  }) {
    // 1. Persist the sync intent locally for absolute Offline Reliability (No data loss if Redis restarts)
    const syncRecord = await this.prisma.syncQueue.create({
      data: {
        factory_id: params.factoryId,
        table_name: params.tableName,
        record_id: params.recordId,
        action: params.action,
        row_data: params.rowData,
        version: params.version,
      },
    });

    // 2. Dispatch to BullMQ for asynchronous background processing
    await this.syncQueue.add(
      'push-to-vps',
      { syncId: syncRecord.id },
      {
        attempts: 10,     // Retries up to 10 times
        backoff: {
          type: 'exponential', // Exponential backoff (1s, 2s, 4s, 8s, etc.)
          delay: 1000,
        },
        removeOnComplete: true, // Keep Redis memory clean
      },
    );

    this.logger.debug(`Queued ${params.tableName} implementation [${syncRecord.id}] for factory ${params.factoryId}.`);
    return syncRecord;
  }
}
