import { Controller, Post, Body, UseGuards, Req, Logger, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { SyncBatchDto } from './dto/sync-batch.dto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 10/10 Enterprise Note: Only the Central VPS runs this specific Controller logic.
 * Local factory instances use the SyncProcessor to hit THIS extremely protected REST endpoint.
 */
@Controller('sync')
@UseGuards(ApiKeyGuard) // Strict Server-to-Server Auth
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async ingestBatchSync(
    @Req() request: any,
    @Body() batchPayload: SyncBatchDto,
  ) {
    // 1. Ensure the Payload factoryId exactly matches the Cryptographic API Key claims
    const authorizedFactory = request.factory;
    if (authorizedFactory.id !== batchPayload.factory_id) {
       throw new Error('Spoofing attempt detected: Payload factory ID does not match API Key context.');
    }

    this.logger.log(`Receiving batch containing ${batchPayload.payload.length} items from Factory ${batchPayload.factory_id}`);

    // 2. MVCC & Idempotent Iteration Engine
    // We process each record. If one fails (bad data), we throw, allowing the Factory to DLQ it safely.
    for (const record of batchPayload.payload) {
      await this.processSingleRecord(authorizedFactory.id, record);
    }

    return { success: true, ingested: batchPayload.payload.length };
  }

  /**
   * The core conflict-resolution logic checking exact entity versions (MVCC).
   */
  private async processSingleRecord(factoryId: number, record: any) {
    if (record.table_name === 'job_cards') {
      
      // Use UPSERT for safety: Creating if missing, upgrading ONLY if incoming version is > existing version
      try {
        await this.prisma.$executeRawUnsafe(`
          INSERT INTO "job_cards" (id, factory_id, entity_version, row_data, created_at)
          VALUES ('${record.record_id}', ${factoryId}, ${record.version}, '${JSON.stringify(record.row_data)}', NOW())
          ON CONFLICT (id) DO UPDATE 
          SET 
            row_data = EXCLUDED.row_data,
            entity_version = EXCLUDED.entity_version,
            updated_at = NOW()
          WHERE 
            "job_cards".id = EXCLUDED.id 
            AND 
            "job_cards".entity_version < EXCLUDED.entity_version;
        `);
      } catch (e) {
        this.logger.error(`Conflict Resolution / SQL Error on ${record.record_id}: ${e.message}`);
        throw e; // Forces Local Factory to DLQ
      }
    }
  }
}
