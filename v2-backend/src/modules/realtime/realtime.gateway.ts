import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * 10/10 Enterprise Note:
 * This Gateway powers the live Next.js factory dashboards and Superadmin aggregation panels.
 * Unlike the SyncQueue (which handles durable database transfers via HTTPS), 
 * WebSockets are purely for ephemeral UI pushing (e.g., green/red sensors).
 */
@WebSocketGateway({
  cors: {
    origin: '*', // Restrict to front-end DNS in production
  },
  namespace: '/live-dashboard', // Isolated namespace strictly for realtime UI updates
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  handleConnection(client: Socket) {
    this.logger.debug(`Live UI Client Connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Live UI Client Disconnected: ${client.id}`);
  }

  /**
   * Broadcasts critical system alerts down to the specific Factory UI instantly.
   * e.g., if the DLQ exceeds limits, red flash the dashboard.
   */
  broadcastCriticalAlert(factoryId: number, message: string) {
    this.server.emit(`factory-${factoryId}-alert`, { timestamp: new Date(), message });
  }

  /**
   * Pushes specific IoT machine states or JobCard progress directly to connected 
   * supervisors within a factory without forcing them to press F5.
   */
  broadcastMachineUpdate(factoryId: number, machineId: string, status: any) {
    this.server.emit(`factory-${factoryId}-machine-status`, { machineId, status });
  }
}
