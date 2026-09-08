import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer, IncomingMessage } from 'http';
import { EventEmitter } from 'events';
import { AuthManager } from './auth';

export interface MobileEvent<T = any> {
  type: string;
  payload: T;
  timestamp: number;
}

export class SocketManager extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private authManager: AuthManager;
  private clients: Map<WebSocket, { deviceId: string; authenticated: boolean }> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(authManager: AuthManager) {
    super();
    this.authManager = authManager;
  }

  public attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token') || '';
      const deviceId = url.searchParams.get('deviceId') || `dev_${Math.random().toString(36).substring(2, 9)}`;
      const userAgent = (req.headers['user-agent'] as string) || 'Mobile Browser';
      const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

      const isAuthenticated = this.authManager.verifyToken(token);

      this.clients.set(ws, { deviceId, authenticated: isAuthenticated });

      if (isAuthenticated) {
        this.authManager.registerDevice(deviceId, userAgent, ip);
        this.sendToClient(ws, 'auth:success', {
          deviceId,
          connectedDevicesCount: this.authManager.getConnectedDevices().length
        });
        this.emit('client:connected', { deviceId, userAgent, ip });
      } else {
        this.sendToClient(ws, 'auth:required', {
          message: 'Authentication token required or invalid'
        });
      }

      ws.on('message', (data: Buffer | string) => {
        try {
          const raw = data.toString();
          const parsed = JSON.parse(raw);
          this.handleClientMessage(ws, parsed);
        } catch (err) {
          console.error('[SocketManager] Failed to parse client message:', err);
        }
      });

      ws.on('close', () => {
        const clientInfo = this.clients.get(ws);
        if (clientInfo) {
          this.clients.delete(ws);
          this.emit('client:disconnected', clientInfo.deviceId);
        }
      });

      ws.on('error', (err) => {
        console.error('[SocketManager] WebSocket client error:', err);
      });
    });

    // Heartbeat every 25 seconds to keep cellular / NAT connections alive
    this.heartbeatInterval = setInterval(() => {
      this.broadcast('ping', { time: Date.now() });
    }, 25000);

    console.log('[SocketManager] WebSocket server attached to /ws');
  }

  private handleClientMessage(ws: WebSocket, message: { type: string; payload: any }): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) {
      return;
    }

    // Allow auth attempt via WebSocket message
    if (message.type === 'auth:submit_pin') {
      const pin = message.payload?.pin || '';
      const deviceId = message.payload?.deviceId || clientInfo.deviceId;
      const res = this.authManager.verifyPin(pin);
      if (res.success && res.token) {
        clientInfo.authenticated = true;
        clientInfo.deviceId = deviceId;
        this.authManager.registerDevice(deviceId, 'Mobile Device', 'ws');
        this.sendToClient(ws, 'auth:success', {
          token: res.token,
          deviceId
        });
        this.emit('client:connected', { deviceId });
      } else {
        this.sendToClient(ws, 'auth:error', { error: res.error || 'Invalid PIN' });
      }
      return;
    }

    if (message.type === 'auth:submit_token') {
      const token = message.payload?.token || '';
      const deviceId = message.payload?.deviceId || clientInfo.deviceId;
      if (this.authManager.verifyToken(token)) {
        clientInfo.authenticated = true;
        clientInfo.deviceId = deviceId;
        this.authManager.registerDevice(deviceId, 'Mobile Device', 'ws');
        this.sendToClient(ws, 'auth:success', { token, deviceId });
        this.emit('client:connected', { deviceId });
      } else {
        this.sendToClient(ws, 'auth:error', { error: 'Invalid or expired session token.' });
      }
      return;
    }

    if (!clientInfo.authenticated) {
      this.sendToClient(ws, 'auth:required', { message: 'Authentication required.' });
      return;
    }

    this.authManager.updateDeviceActivity(clientInfo.deviceId);

    // Forward authenticated client actions to extension listeners
    switch (message.type) {
      case 'pong':
        break;
      case 'client:prompt':
        this.emit('client:prompt', message.payload);
        break;
      case 'client:interrupt':
        this.emit('client:interrupt', message.payload);
        break;
      case 'client:approval_response':
        this.emit('client:approval_response', message.payload);
        break;
      default:
        this.emit(message.type, message.payload);
        break;
    }
  }

  public broadcast(type: string, payload: any): void {
    if (!this.wss) {
      return;
    }

    const message: MobileEvent = {
      type,
      payload,
      timestamp: Date.now()
    };
    const serialized = JSON.stringify(message);

    for (const [ws, info] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN && info.authenticated) {
        ws.send(serialized);
      }
    }
  }

  public sendToClient(ws: WebSocket, type: string, payload: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      const message: MobileEvent = {
        type,
        payload,
        timestamp: Date.now()
      };
      ws.send(JSON.stringify(message));
    }
  }

  public disconnectAll(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const ws of this.clients.keys()) {
      try {
        ws.close(1000, 'Session terminated by workstation');
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.authManager.clearAllDevices();
  }

  public getConnectedClientsCount(): number {
    let count = 0;
    for (const info of this.clients.values()) {
      if (info.authenticated) {
        count++;
      }
    }
    return count;
  }
}
