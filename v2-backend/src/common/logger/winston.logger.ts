import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

/**
 * 10/10 Observability: 
 * We output structured JSON in production so Datadog/Grafana can parse it immediately.
 * In development, we use colorful, human-readable console output.
 */
export const winstonLoggerFactory = WinstonModule.createLogger({
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production' 
        ? winston.format.json() 
        : winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, context, trace }) => {
              return `${timestamp} [${context}] ${level}: ${message}${trace ? `\n${trace}` : ''}`;
            }),
          ),
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    }),
    
    // Output critical errors to this local file as a hard backup
    // if the centralized logging server goes down.
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: winston.format.json()
    }),
  ],
});
