import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('wip')
  // For now we allow open access or use a dummy guard if JWT is not yet globally registered
  // In a real V2, we'd use @UseGuards(JwtAuthGuard)
  async getWipReport(
    @Query('factory_id') factory_id?: number,
    @Query('type') type: 'summary' | 'detail' = 'summary',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.reportsService.getWipReport({
      factory_id,
      type,
      from,
      to,
      search,
    });
  }
}
