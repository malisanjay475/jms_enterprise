import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getWipReport(params: {
    factory_id?: number;
    from?: string;
    to?: string;
    type: 'summary' | 'detail';
    search?: string;
  }) {
    const { factory_id, from, to, type, search } = params;

    this.logger.log(`Generating WIP ${type} report for factory: ${factory_id || 'ALL'}`);

    if (type === 'summary') {
      // Summary aggregation logic
      return this.prisma.wipStockSnapshotLine.groupBy({
        by: ['factory_unit', 'item_code', 'item_name', 'uom'],
        where: {
          factory_id: factory_id ? Number(factory_id) : undefined,
          stock_date: {
            gte: from ? new Date(from) : undefined,
            lte: to ? new Date(to) : undefined,
          },
          OR: search ? [
            { item_code: { contains: search, mode: 'insensitive' } },
            { item_name: { contains: search, mode: 'insensitive' } }
          ] : undefined,
        },
        _sum: {
          total_qty: true,
        },
        _count: {
          id: true,
        },
        orderBy: {
          item_code: 'asc',
        },
      }).then(data => data.map(row => ({
        factory_unit: row.factory_unit,
        item_code: row.item_code,
        item_name: row.item_name,
        uom: row.uom,
        total_qty: row._sum.total_qty,
        entries_count: row._count.id,
      })));
    } else {
      // Detailed View
      return this.prisma.wipStockSnapshotLine.findMany({
        where: {
          factory_id: factory_id ? Number(factory_id) : undefined,
          stock_date: {
            gte: from ? new Date(from) : undefined,
            lte: to ? new Date(to) : undefined,
          },
          OR: search ? [
            { item_code: { contains: search, mode: 'insensitive' } },
            { item_name: { contains: search, mode: 'insensitive' } },
            { job_no: { contains: search, mode: 'insensitive' } }
          ] : undefined,
        },
        orderBy: {
          stock_date: 'desc',
        },
        take: 1000, // Safety limit
      });
    }
  }
}
