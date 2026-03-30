import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 10/10 Enterprise Security:
 * The Master VPS uses this Guard on exactly `/api/v1/sync/*` endpoints.
 * Local factory servers send their payloads along with `x-api-key`.
 * This checks the DB to ensure the factory is authorized and not deactivated.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('Factory API Key required.');
    }

    // Lookup Factory in DB leveraging Prisma
    const factory = await this.prisma.factory.findUnique({
      where: { api_key: apiKey },
    });

    if (!factory || !factory.is_active) {
      throw new UnauthorizedException('Invalid or Deactivated Factory API Key.');
    }

    // Attach factory data to the request object so subsequent controllers 
    // know EXACTLY which factory this sync payload belongs to.
    request.factory = factory;

    return true;
  }
}
