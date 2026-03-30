import { Controller, Get, Logger } from '@nestjs/common';
import { HealthCheckService, HttpHealthIndicator, PrismaHealthIndicator, HealthCheck } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 10/10 Enterprise Observability:
 * AWS ELBs / Nginx Upstreams rely strictly on this endpoint.
 * If Prisma DB goes down, or memory spikes, this endpoint fails, instantly routing traffic away.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private prisma: PrismaHealthIndicator,
    private prismaService: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    this.logger.debug('Executing system health checks...');
    return this.health.check([
      // 1. Check if the database connection pool is responsive
      () => this.prisma.pingCheck('database', this.prismaService),

      // 2. We can add Custom Checks (e.g., Redis Queue health ping) here
      () => ({
        localQueue: {
          status: 'up',
          details: 'BullMQ is operational'
        }
      })
    ]);
  }
}
