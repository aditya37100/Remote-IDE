import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as path from 'path';
import { AuthManager } from './auth';
import { SocketManager } from './socket';
import { WorkspaceManager } from '../bridge/workspaceFiles';

export interface ServerOptions {
  port: number;
  workspaceRoot: string;
  expiryHours?: number;
}

export class MobileCompanionServer {
  private app: express.Express;
  private server: http.Server | null = null;
  private authManager: AuthManager;
  private socketManager: SocketManager;
  private workspaceManager: WorkspaceManager;
  private port: number;
  private isListening = false;

  constructor(options: ServerOptions) {
    this.port = options.port;
    this.authManager = new AuthManager(options.expiryHours ?? 3);
    this.socketManager = new SocketManager(this.authManager);
    this.workspaceManager = new WorkspaceManager(options.workspaceRoot);
    this.app = express();

    this.configureMiddleware();
    this.configureRoutes();
  }

  public getAuthManager(): AuthManager {
    return this.authManager;
  }

  public getSocketManager(): SocketManager {
    return this.socketManager;
  }

  public getWorkspaceManager(): WorkspaceManager {
    return this.workspaceManager;
  }

  public getPort(): number {
    return this.port;
  }

  private configureMiddleware(): void {
    this.app.use(express.json());

    // Basic CORS for mobile development/tunnel access
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });
  }

  private requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query.token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (!this.authManager.verifyToken(token)) {
      res.status(401).json({ error: 'Unauthorized. Invalid or expired token.' });
      return;
    }

    next();
  };

  private configureRoutes(): void {
    // 1. Health / Status
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        status: 'online',
        workspaceRoot: path.basename(this.workspaceManager.getWorkspaceRoot()),
        connectedDevices: this.authManager.getConnectedDevices().length,
        expiresAt: this.authManager.getExpiresAt(),
        isExpired: this.authManager.isExpired()
      });
    });

    // 2. PIN Authentication endpoint
    this.app.post('/api/auth/pin', (req: Request, res: Response) => {
      const { pin, deviceId, userAgent } = req.body || {};
      if (!pin) {
        res.status(400).json({ error: 'PIN is required' });
        return;
      }

      const result = this.authManager.verifyPin(String(pin));
      if (!result.success) {
        res.status(401).json({ error: result.error });
        return;
      }

      const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
      const dev = this.authManager.registerDevice(
        deviceId || `dev_${Math.random().toString(36).substring(2, 9)}`,
        userAgent || (req.headers['user-agent'] as string) || 'Mobile Device',
        ip
      );

      res.json({
        success: true,
        token: result.token,
        device: dev,
        expiresAt: this.authManager.getExpiresAt()
      });
    });

    // 3. Workspace File Tree (Protected)
    this.app.get('/api/files/tree', this.requireAuth, async (req: Request, res: Response) => {
      try {
        const tree = await this.workspaceManager.getFileTree(4);
        res.json({ tree });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to fetch file tree' });
      }
    });

    // 4. File Content Reader (Protected)
    this.app.get('/api/files/content', this.requireAuth, async (req: Request, res: Response) => {
      const filePath = req.query.path;
      if (!filePath || typeof filePath !== 'string') {
        res.status(400).json({ error: 'Missing path query parameter' });
        return;
      }

      const fileData = await this.workspaceManager.getFileContent(filePath);
      if (!fileData) {
        res.status(404).json({ error: 'File not found or outside workspace boundary' });
        return;
      }

      res.json(fileData);
    });

    // 5. Git Diff (Protected)
    this.app.get('/api/git/diff', this.requireAuth, async (req: Request, res: Response) => {
      try {
        const diffs = await this.workspaceManager.getGitDiff();
        res.json({ diffs });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to get git diff' });
      }
    });

    // When esbuild bundles to dist/extension.js, __dirname = <ext>/dist/
    // So '../web' correctly resolves to <ext>/web/
    const webDir = path.resolve(__dirname, '../web');
    console.log(`[MobileCompanionServer] Serving static files from: ${webDir}`);
    this.app.use(express.static(webDir));

    // Fallback for SPA routing to index.html
    this.app.get('*', (req: Request, res: Response) => {
      const indexPath = path.join(webDir, 'index.html');
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`[MobileCompanionServer] index.html not found at ${indexPath}. Serving fallback.`);
          res.status(200).send(`
            <!DOCTYPE html>
            <html>
              <head><title>Antigravity Remote Companion</title></head>
              <body style="font-family:sans-serif;background:#111;color:#fff;text-align:center;padding:50px;">
                <h1>Antigravity Remote Companion</h1>
                <p>Web client files not found.</p>
                <p style="font-size:12px;color:#888;margin-top:20px;">Expected path: ${indexPath}</p>
                <p style="font-size:12px;color:#888;">__dirname: ${__dirname}</p>
              </body>
            </html>
          `);
        }
      });
    });
  }

  public async start(): Promise<number> {
    if (this.isListening && this.server) {
      return this.port;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      this.socketManager.attach(this.server);

      // Listen on 0.0.0.0 so local network Wi-Fi can connect directly, or tunnel can route
      this.server.listen(this.port, '0.0.0.0', () => {
        this.isListening = true;
        console.log(`[MobileCompanionServer] Listening on http://localhost:${this.port}`);
        resolve(this.port);
      });

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[MobileCompanionServer] Port ${this.port} is in use, trying random port...`);
          this.port = 0; // random port
          this.server?.listen(0, '0.0.0.0', () => {
            const addr = this.server?.address();
            if (addr && typeof addr === 'object') {
              this.port = addr.port;
              this.isListening = true;
              console.log(`[MobileCompanionServer] Listening on random port http://localhost:${this.port}`);
              resolve(this.port);
            }
          });
        } else {
          reject(err);
        }
      });
    });
  }

  public async stop(): Promise<void> {
    this.socketManager.disconnectAll();
    if (this.server) {
      return new Promise((resolve) => {
        this.server?.close(() => {
          this.isListening = false;
          this.server = null;
          console.log('[MobileCompanionServer] Server stopped.');
          resolve();
        });
      });
    }
  }
}
