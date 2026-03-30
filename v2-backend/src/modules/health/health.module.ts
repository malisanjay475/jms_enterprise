import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    TerminusModule,
    // Enterprise Standard: Exposes `/metrics` endpoint dynamically scraping 
    // garbage collection metrics, CPU cycles, Node.js heap allocations,
    // and custom HTTP route latencies so Grafana Dashboards are populated.
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true, // Enables default OS/Node.js level metrics out of the box
      },
    }),
  ],
  controllers: [HealthController],
})
export class HealthAndMetricsModule {}
