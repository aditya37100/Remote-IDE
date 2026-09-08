import { spawn, ChildProcess, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import { EventEmitter } from 'events';

// localtunnel is a pure npm dependency — no binary download needed
let localtunnel: any;
try {
  localtunnel = require('localtunnel');
} catch {
  // Will be handled at runtime
}

export interface TunnelStatus {
  active: boolean;
  publicUrl: string | null;
  localLanUrl: string | null;
  port: number;
  provider?: string;
  error?: string;
}

export class TunnelManager extends EventEmitter {
  private childProcess: ChildProcess | null = null;
  private ltTunnel: any = null; // localtunnel instance
  private port: number;
  private publicUrl: string | null = null;
  private provider: string = 'none';
  private binDir: string;
  private cloudflaredPath: string;
  private cfError: string = ''; // Store cloudflare error for combined error message

  private proxyUrl?: string;

  constructor(port: number, extensionStoragePath?: string, proxyUrl?: string) {
    super();
    this.port = port;
    this.proxyUrl = proxyUrl;
    // When esbuild bundles to dist/extension.js, __dirname = <ext>/dist/
    // So '../bin' correctly resolves to <ext>/bin/
    this.binDir = extensionStoragePath
      ? path.join(extensionStoragePath, 'bin')
      : path.resolve(__dirname, '../bin');
    this.cloudflaredPath = path.join(this.binDir, os.platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  }

  public getPublicUrl(): string | null {
    return this.publicUrl;
  }

  public getProvider(): string {
    return this.provider;
  }

  public getLocalLanUrl(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netInterfaces = interfaces[name];
      if (!netInterfaces) {
        continue;
      }
      for (const net of netInterfaces) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254')) {
          return `http://${net.address}:${this.port}`;
        }
      }
    }
    return `http://localhost:${this.port}`;
  }

  public getStatus(): TunnelStatus {
    return {
      active: this.publicUrl !== null,
      publicUrl: this.publicUrl,
      localLanUrl: this.getLocalLanUrl(),
      port: this.port,
      provider: this.provider
    };
  }

  /**
   * Checks if cloudflared is available on the system PATH.
   * Returns the resolved path if found, null otherwise.
   */
  private findCloudflaredInPath(): Promise<string | null> {
    return new Promise((resolve) => {
      const cmd = os.platform() === 'win32' ? 'where' : 'which';
      execFile(cmd, ['cloudflared'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          resolve(null);
          return;
        }
        // `where` on Windows may return multiple lines; take the first
        const found = stdout.trim().split(/\r?\n/)[0].trim();
        if (found && fs.existsSync(found)) {
          console.log(`[TunnelManager] Found cloudflared in PATH: ${found}`);
          resolve(found);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Ensures the cloudflared binary is available.
   * Checks PATH first, then local cache, then downloads from GitHub.
   */
  public async ensureBinary(): Promise<string> {
    // 1. Check if we already downloaded it to our local bin dir
    try {
      if (fs.existsSync(this.cloudflaredPath)) {
        console.log(`[TunnelManager] Using cached cloudflared: ${this.cloudflaredPath}`);
        return this.cloudflaredPath;
      }
    } catch {
      // ignore
    }

    // 2. Check if cloudflared is available on the system PATH
    const pathBinary = await this.findCloudflaredInPath();
    if (pathBinary) {
      return pathBinary;
    }

    // 3. Download cloudflared from GitHub releases
    if (!fs.existsSync(this.binDir)) {
      await fs.promises.mkdir(this.binDir, { recursive: true });
    }

    const platform = os.platform();
    let downloadUrl = '';

    if (platform === 'win32') {
      downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
    } else if (platform === 'darwin') {
      downloadUrl = os.arch() === 'arm64'
        ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz'
        : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
    } else {
      downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    }

    console.log(`[TunnelManager] Downloading cloudflared from ${downloadUrl}...`);
    this.emit('download:start', { url: downloadUrl });

    await this.downloadFile(downloadUrl, this.cloudflaredPath);

    if (platform !== 'win32') {
      await fs.promises.chmod(this.cloudflaredPath, 0o755);
    }

    console.log(`[TunnelManager] cloudflared downloaded to ${this.cloudflaredPath}`);
    this.emit('download:complete', { path: this.cloudflaredPath });
    return this.cloudflaredPath;
  }

  private getEnvWithProxy(): NodeJS.ProcessEnv {
    const env = Object.assign({}, process.env);
    if (this.proxyUrl) {
      env.HTTP_PROXY = this.proxyUrl;
      env.HTTPS_PROXY = this.proxyUrl;
      env.http_proxy = this.proxyUrl;
      env.https_proxy = this.proxyUrl;
    }
    return env;
  }

  /**
   * Downloads a file from a URL, following up to 10 redirects across http/https.
   * Properly drains response bodies on redirect to prevent socket hangs.
   * Times out after 60 seconds.
   */
  private downloadFile(url: string, destPath: string): Promise<void> {
    const MAX_REDIRECTS = 10;
    const TIMEOUT_MS = 60000;

    return new Promise((resolve, reject) => {
      let redirectCount = 0;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          fs.unlink(destPath, () => {});
          reject(new Error(`Download timed out after ${TIMEOUT_MS / 1000} seconds`));
        }
      }, TIMEOUT_MS);

      const done = (err?: Error) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        if (err) {
          fs.unlink(destPath, () => {});
          reject(err);
        } else {
          resolve();
        }
      };

      const doRequest = (currentUrl: string) => {
        if (settled) { return; }

        console.log(`[TunnelManager] GET ${currentUrl} (redirect #${redirectCount})`);

        // Pick the right module based on the URL's protocol
        const requester = currentUrl.startsWith('https://') ? https : http;

        requester.get(currentUrl, (res) => {
          const statusCode = res.statusCode || 0;

          // Handle redirects (301, 302, 303, 307, 308)
          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            redirectCount++;
            if (redirectCount > MAX_REDIRECTS) {
              res.resume();
              done(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
              return;
            }

            // IMPORTANT: drain the current response body to free the socket
            res.resume();

            let nextUrl = res.headers.location;
            // Handle relative redirects
            if (nextUrl.startsWith('/')) {
              const parsed = new URL(currentUrl);
              nextUrl = `${parsed.protocol}//${parsed.host}${nextUrl}`;
            }

            doRequest(nextUrl);
            return;
          }

          if (statusCode >= 400) {
            res.resume();
            done(new Error(`Download failed with HTTP ${statusCode}`));
            return;
          }

          // Success — pipe to file
          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            done();
          });

          fileStream.on('error', (err) => {
            done(err);
          });

          res.on('error', (err) => {
            done(err);
          });
        }).on('error', (err) => {
          done(err);
        });
      };

      doRequest(url);
    });
  }

  /**
   * Starts a tunnel. Tries Cloudflare Quick Tunnel first, then falls back
   * to localtunnel (pure npm, no binary download needed).
   */
  public async start(): Promise<string> {
    if (this.publicUrl) {
      return this.publicUrl;
    }

    // ── Attempt 1: Cloudflare Quick Tunnel ──────────────────────────
    try {
      const url = await this.startCloudflare();
      this.provider = 'cloudflare';
      return url;
    } catch (cfErr: any) {
      this.cfError = cfErr.message || String(cfErr);
      console.warn(`[TunnelManager] Cloudflare tunnel failed: ${this.cfError}`);
      console.log('[TunnelManager] Falling back to localtunnel...');
    }

    // ── Attempt 2: localtunnel (npm, zero binary) ───────────────────
    try {
      const url = await this.startLocaltunnel();
      this.provider = 'localtunnel';
      return url;
    } catch (ltErr: any) {
      console.error(`[TunnelManager] localtunnel also failed: ${ltErr.message || ltErr}`);
      throw new Error(
        `All tunnel providers failed.\n` +
        `Cloudflare: ${this.cfError}\n` +
        `Localtunnel: ${ltErr.message || 'unknown'}\n` +
        `Connect via same Wi-Fi network as fallback.`
      );
    }
  }

  /**
   * Starts Cloudflare Quick Tunnel and extracts trycloudflare.com URL.
   */
  private async startCloudflare(): Promise<string> {
    const binaryPath = await this.ensureBinary();
    console.log(`[TunnelManager] Binary path: ${binaryPath}`);
    console.log(`[TunnelManager] Binary exists: ${fs.existsSync(binaryPath)}`);

    return new Promise((resolve, reject) => {
      const args = ['tunnel', '--url', `http://127.0.0.1:${this.port}`];

      console.log(`[TunnelManager] Spawning: ${binaryPath} ${args.join(' ')} (Proxy: ${this.proxyUrl || 'none'})`);
      this.childProcess = spawn(binaryPath, args, {
        windowsHide: true,
        env: this.getEnvWithProxy()
      });

      let resolved = false;
      let outputBuffer = '';
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.error(`[TunnelManager] Tunnel timed out. Output so far:\n${outputBuffer}`);
          this.stopCloudflare();
          reject(new Error('Cloudflare tunnel startup timed out after 45 seconds.'));
        }
      }, 45000);

      const urlRegex = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        outputBuffer += text;
        console.log(`[TunnelManager] cloudflared: ${text.trim()}`);
        const match = text.match(urlRegex);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.publicUrl = match[0];
          console.log(`[TunnelManager] Quick tunnel established: ${this.publicUrl}`);
          this.emit('ready', { publicUrl: this.publicUrl, localLanUrl: this.getLocalLanUrl() });
          resolve(this.publicUrl);
        }
      };

      this.childProcess.stdout?.on('data', handleOutput);
      this.childProcess.stderr?.on('data', handleOutput);

      this.childProcess.on('error', (err) => {
        console.error('[TunnelManager] cloudflared process error:', err.message);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared failed to start: ${err.message}`));
        }
        this.emit('error', err);
      });

      this.childProcess.on('close', (code) => {
        console.log(`[TunnelManager] cloudflared process exited with code ${code}`);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited with code ${code}. Output:\n${outputBuffer.slice(-500)}`));
        }
        this.childProcess = null;
        this.publicUrl = null;
        this.emit('closed', code);
      });
    });
  }

  /**
   * Starts a localtunnel — pure npm, no binary download needed.
   * Works behind firewalls, CGNAT, and restrictive networks.
   */
  private async startLocaltunnel(): Promise<string> {
    if (!localtunnel) {
      throw new Error('localtunnel module not available');
    }

    console.log(`[TunnelManager] Starting localtunnel on port ${this.port}...`);

    this.ltTunnel = await localtunnel({ port: this.port });
    this.publicUrl = this.ltTunnel.url;

    console.log(`[TunnelManager] localtunnel established: ${this.publicUrl}`);
    this.emit('ready', { publicUrl: this.publicUrl, localLanUrl: this.getLocalLanUrl() });

    this.ltTunnel.on('close', () => {
      console.log('[TunnelManager] localtunnel closed');
      this.ltTunnel = null;
      this.publicUrl = null;
      this.emit('closed', 0);
    });

    this.ltTunnel.on('error', (err: Error) => {
      console.error('[TunnelManager] localtunnel error:', err.message);
      this.emit('error', err);
    });

    return this.publicUrl!;
  }

  private stopCloudflare(): void {
    if (this.childProcess) {
      try {
        if (os.platform() === 'win32') {
          spawn('taskkill', ['/pid', this.childProcess.pid!.toString(), '/f', '/t']);
        } else {
          this.childProcess.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
      this.childProcess = null;
    }
  }

  public stop(): void {
    // Stop Cloudflare tunnel process
    this.stopCloudflare();

    // Stop localtunnel
    if (this.ltTunnel) {
      try {
        this.ltTunnel.close();
      } catch {
        // ignore
      }
      this.ltTunnel = null;
    }

    this.publicUrl = null;
    this.provider = 'none';
    console.log('[TunnelManager] Tunnel stopped.');
  }
}
