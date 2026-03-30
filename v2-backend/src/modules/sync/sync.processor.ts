import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncStatus } from '@prisma/client';

@Processor('local-sync-queue', { concurrency: 5 })
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ syncId: string }>): Promise<any> {
    const { syncId } = job.data;
    
    // 1. Lock the local record
    const record = await this.prisma.syncQueue.findUnique({
      where: { id: syncId }
    });

    if (!record || record.sync_status === SyncStatus.SUCCESS) {
      this.logger.debug(`Skipping already processed sync ${syncId}`);
      return; 
    }

    try {
      this.logger.log(`Attempting to sync record [${record.table_name}:${record.record_id}] to Master VPS.`);
      
      // 2. Perform outbound HTTP POST to Master VPS (Simulated for this script)
      // await axios.post('https://vps.domain.com/api/v1/sync/batch', payload, { headers: { 'x-api-key': 'FACTORY_SECRET' } });
      
      // Simulate network request time
      await new Promise(resolve => setTimeout(resolve, 300));

      // 3. Mark success
      await this.prisma.syncQueue.update({
        where: { id: syncId },
        data: { 
          sync_status: SyncStatus.SUCCESS,
          last_attempt: new Date(),
        }
      });
      this.logger.log(`✅ Success syncing [${record.table_name}:${record.record_id}]`);

    } catch (error) {
      // 4. Dead Letter Queue / Retry Capture
      await this.prisma.syncQueue.update({
        where: { id: syncId },
        data: {
          last_attempt: new Date(),
          retry_count: { increment: 1 },
          error_message: error.message,
          // If we hit our max retries (e.g. 10), permanently fail it so operators can review
          sync_status: job.attemptsMade >= 9 ? SyncStatus.FAILED : SyncStatus.PROCESSING,
        }
      });
      // Throwing error triggers BullMQ's automatic exponential backoff
      this.logger.warn(`❌ Sync attempt ${job.attemptsMade + 1} failed for ${syncId}: ${error.message}`);
      throw error; 
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    if (job.attemptsMade >= 9) {
      this.logger.error(`🚨 DLQ ALERT: Sync Payload permanently failed after max retries: ${job.data.syncId}`);
      // Push critical alert to WebSocket or Notification Service here
    }
  }
}
