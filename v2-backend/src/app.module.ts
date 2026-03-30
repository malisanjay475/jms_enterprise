import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { HealthAndMetricsModule } from './modules/health/health.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import * as Joi from 'joi'; // We must run npm install joi for this

@Module({
  imports: [
    // -----------------------------------------------------------------
    // 1. Immutable Environment Validation
    // The server CRASHES before booting if a single variable is missing.
    // -----------------------------------------------------------------
    ConfigModule.forRoot({
      isGlobal: true,   // Accessible anywhere via ConfigService
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test', 'staging')
          .default('development'),
          
        PORT: Joi.number().default(3000),
        
        // Postgres Database
        DATABASE_URL: Joi.string().required(),
        
        // Redis Connection for Event Mesh and SyncQueues
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        REDIS_PASSWORD: Joi.string().allow('', null).optional(),
        
        // Security Secrets
        JWT_SECRET: Joi.string().required().min(32), // High entropy enforced
      }),
      // Do NOT proceed if unknown variables slip in during prod deployment
      validationOptions: {
        allowUnknown: true, 
        abortEarly: true,
      },
    }),

    // -----------------------------------------------------------------
    // 2. Database Services
    // -----------------------------------------------------------------
    PrismaModule,

    // -----------------------------------------------------------------
    // 3. Central Event Queue & Sync Worker (BullMQ + Redis)
    // -----------------------------------------------------------------
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        // Enterprise Setting: Ensures retries happen gracefully on disconnect
        maxRetriesPerRequest: null, 
      },
    }),

    // -----------------------------------------------------------------
    // 4. Observability & WebSockets
    // -----------------------------------------------------------------
    HealthAndMetricsModule,
    RealtimeModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
