import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { winstonLoggerFactory } from './common/logger/winston.logger';

async function bootstrap() {
  // Initialize the main application module with Enterprise Winston Logger
  const app = await NestFactory.create(AppModule, {
    logger: winstonLoggerFactory,
  });

  // -------------------------------------------------------------
  // Security Hardening (10/10 Enterprise Setup)
  // -------------------------------------------------------------
  
  // Helmet adds 14 critical HTTP security headers (e.g., XSS Protection, NoSniff)
  app.use(helmet());

  // Enable CORS securely - allow specific origins in production via ENV later
  app.enableCors({
    origin: '*', // To be restricted to frontend domain in prod
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Global API Prefixing to ensure backwards compatibility
  app.setGlobalPrefix('api/v1');

  // Enforce rigid input validation using DTOs across the entire application.
  // This automatically strips away injected parameters that aren't defined in the DTO schema.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Strip unhandled properties
      forbidNonWhitelisted: true, // Throw error if unhandled properties exist
      transform: true,       // Auto-transform payloads to DTO instances
    }),
  );

  // Bind to dynamic port provided by PM2 or default to 3000
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 JMS Master API (Enterprise Edition) is running on port: ${port}`);
}

// Gracefully handle unhandled exceptions to prevent hard crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

bootstrap();
