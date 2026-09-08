import * as vscode from 'vscode';
import * as QRCode from 'qrcode';
import { MobileCompanionServer } from '../server/app';
import { TunnelManager } from '../server/tunnel';
import { SessionLifecycleManager } from '../bridge/keepAwake';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'antigravityRemote.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly getServer: () => MobileCompanionServer | null,
    private readonly getTunnel: () => TunnelManager | null,
    private readonly getLifecycle: () => SessionLifecycleManager | null
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    this.refresh();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'start':
          vscode.commands.executeCommand('antigravityRemote.start');
          break;
        case 'stop':
          vscode.commands.executeCommand('antigravityRemote.stop');
          break;
        case 'regeneratePin':
          vscode.commands.executeCommand('antigravityRemote.regeneratePin');
          this.refresh();
          break;
        case 'openBrowser':
          vscode.commands.executeCommand('antigravityRemote.openInBrowser');
          break;
        case 'extendTimer':
          const lifecycle = this.getLifecycle();
          if (lifecycle) {
            lifecycle.extend(1);
            vscode.window.showInformationMessage('Session extended by 1 hour.');
            this.refresh();
          }
          break;
        case 'copy':
          if (data.text) {
            await vscode.env.clipboard.writeText(data.text);
            vscode.window.showInformationMessage(`Copied to clipboard: ${data.text}`);
          }
          break;
        case 'disconnectDevice':
          const server = this.getServer();
          if (server && data.deviceId) {
            server.getAuthManager().removeDevice(data.deviceId);
            vscode.window.showInformationMessage(`Disconnected device: ${data.deviceId}`);
            this.refresh();
          }
          break;
      }
    });
  }

  public async refresh() {
    if (!this._view) {
      return;
    }

    const server = this.getServer();
    const tunnel = this.getTunnel();
    const lifecycle = this.getLifecycle();

    const isRunning = server !== null;
    let qrDataUrl = '';
    let publicUrl = '';
    let localLanUrl = '';
    let pin = '';
    let token = '';
    let remainingTimeStr = '';
    let devices: any[] = [];

    if (isRunning && server) {
      pin = server.getAuthManager().getPin();
      token = server.getAuthManager().getSessionToken();
      devices = server.getAuthManager().getConnectedDevices();

      const port = server.getPort();
      localLanUrl = tunnel ? tunnel.getLocalLanUrl() || `http://localhost:${port}` : `http://localhost:${port}`;
      publicUrl = tunnel?.getPublicUrl() || '';

      // QR code URL does NOT include token — user must enter PIN to authenticate
      const targetUrl = publicUrl || localLanUrl;

      try {
        qrDataUrl = await QRCode.toDataURL(targetUrl, {
          margin: 1,
          width: 200,
          color: {
            dark: '#0f172a',
            light: '#ffffff'
          }
        });
      } catch (err) {
        console.error('Failed to generate QR code:', err);
      }

      if (lifecycle) {
        const ms = lifecycle.getRemainingMs();
        if (ms !== null) {
          const totalSec = Math.floor(ms / 1000);
          const hrs = Math.floor(totalSec / 3600);
          const mins = Math.floor((totalSec % 3600) / 60);
          remainingTimeStr = `${hrs}h ${mins}m`;
        }
      }
    }

    this._view.webview.html = this.getHtml(isRunning, {
      qrDataUrl,
      publicUrl: publicUrl || '',
      localLanUrl,
      pin,
      remainingTimeStr,
      devices
    });
  }

  private getHtml(isRunning: boolean, data: any): string {
    if (!isRunning) {
      return `<!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; text-align: center; }
          .start-card { background: var(--vscode-sideBar-background); border: 1px dashed var(--vscode-widget-border); border-radius: 8px; padding: 24px 16px; margin-top: 20px; }
          .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 10px 16px; border-radius: 4px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 16px; font-size: 13px; }
          .btn:hover { background: var(--vscode-button-hoverBackground); }
          .icon { font-size: 32px; margin-bottom: 8px; }
        </style>
      </head>
      <body>
        <div class="start-card">
          <div class="icon">📱</div>
          <h3>Antigravity Remote</h3>
          <p style="font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px;">
            Leave your laptop anywhere and control your agent, view diffs, and approve tasks from your phone.
          </p>
          <button class="btn" onclick="vscode.postMessage({ type: 'start' })">Start Remote Session</button>
        </div>
        <script>const vscode = acquireVsCodeApi();</script>
      </body>
      </html>`;
    }

    return `<!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; font-size: 12px; }
        .badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 12px; background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 600; font-size: 11px; }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; }
        .qr-card { background: #ffffff; border-radius: 10px; padding: 10px; margin: 12px auto; display: flex; justify-content: center; width: 180px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .qr-card img { width: 160px; height: 160px; display: block; }
        .pin-box { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 10px; text-align: center; margin: 10px 0; }
        .pin-number { font-size: 24px; font-weight: 700; letter-spacing: 6px; color: var(--vscode-textLink-foreground); font-family: monospace; }
        .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 7px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-danger { background: rgba(244, 63, 94, 0.2); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.4); }
        .btn-block { width: 100%; margin-top: 6px; }
        .url-box { background: var(--vscode-editor-background); padding: 8px; border-radius: 4px; margin-top: 8px; word-break: break-all; font-family: monospace; font-size: 11px; border: 1px solid var(--vscode-widget-border); display: flex; align-items: center; justify-content: space-between; }
        .section-title { font-weight: 600; margin-top: 14px; margin-bottom: 6px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
        .device-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--vscode-widget-border); }
      </style>
    </head>
    <body>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span class="badge"><span class="dot"></span> Online</span>
        ${data.remainingTimeStr ? `<span style="color:var(--vscode-descriptionForeground);">⏱ ${data.remainingTimeStr}</span>` : ''}
      </div>

      <div class="qr-card">
        ${data.qrDataUrl ? `<img src="${data.qrDataUrl}" alt="Scan QR code with phone camera" />` : '<div style="color:#000;padding:40px;">Generating...</div>'}
      </div>
      <p style="text-align:center; font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:8px;">Scan with phone camera to connect instantly</p>

      <div class="pin-box">
        <div style="font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:4px;">PAIRING PIN</div>
        <div class="pin-number">${data.pin}</div>
        <div style="display:flex; gap:6px; margin-top:6px;">
          <button class="btn btn-secondary" style="flex:1;" onclick="vscode.postMessage({ type: 'copy', text: '${data.pin}' })">Copy PIN</button>
          <button class="btn btn-secondary" style="flex:1;" onclick="vscode.postMessage({ type: 'regeneratePin' })">New PIN</button>
        </div>
      </div>

      <div class="section-title">Remote Links</div>
      ${data.publicUrl ? `
        <div class="url-box">
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80%;">Cloudflare: ${data.publicUrl}</span>
          <button class="btn btn-secondary" style="padding:2px 6px;" onclick="vscode.postMessage({ type: 'copy', text: '${data.publicUrl}' })">Copy</button>
        </div>
      ` : '<div style="font-size:11px; color:var(--vscode-descriptionForeground);">Generating Cloudflare tunnel...</div>'}

      <div class="url-box">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80%;">Local Wi-Fi: ${data.localLanUrl}</span>
        <button class="btn btn-secondary" style="padding:2px 6px;" onclick="vscode.postMessage({ type: 'copy', text: '${data.localLanUrl}' })">Copy</button>
      </div>

      <div class="section-title">Paired Devices (${data.devices.length})</div>
      ${data.devices.length === 0 ? '<div style="color:var(--vscode-descriptionForeground);font-size:11px;">No devices paired yet.</div>' : ''}
      ${data.devices.map((d: any) => `
        <div class="device-row">
          <div>
            <div style="font-weight:600;">📱 ${d.userAgent.split(' ')[0]}</div>
            <div style="font-size:10px; color:var(--vscode-descriptionForeground);">${d.ip}</div>
          </div>
          <button class="btn btn-danger" style="padding:2px 6px; font-size:11px;" onclick="vscode.postMessage({ type: 'disconnectDevice', deviceId: '${d.id}' })">Revoke</button>
        </div>
      `).join('')}

      <div style="margin-top:16px; display:flex; flex-direction:column; gap:6px;">
        <button class="btn btn-secondary btn-block" onclick="vscode.postMessage({ type: 'extendTimer' })">+1 Hour Session Time</button>
        <button class="btn btn-secondary btn-block" onclick="vscode.postMessage({ type: 'openBrowser' })">Open Companion in Desktop Browser</button>
        <button class="btn btn-danger btn-block" onclick="vscode.postMessage({ type: 'stop' })">Stop Remote Session</button>
      </div>

      <script>const vscode = acquireVsCodeApi();</script>
    </body>
    </html>`;
  }
}
