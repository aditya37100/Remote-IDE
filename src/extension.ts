import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { MobileCompanionServer } from './server/app';
import { TunnelManager } from './server/tunnel';
import { SessionLifecycleManager } from './bridge/keepAwake';
import { SidebarViewProvider } from './views/sidebarProvider';
import { TelegramNotifier } from './bridge/telegramNotifier';

let statusBarItem: vscode.StatusBarItem;
let companionServer: MobileCompanionServer | null = null;
let tunnelManager: TunnelManager | null = null;
let sessionLifecycle: SessionLifecycleManager | null = null;
let sidebarProvider: SidebarViewProvider | null = null;
let telegramNotifier: TelegramNotifier | null = null;
let isRunning = false;

export function activate(context: vscode.ExtensionContext) {
  console.log('[Antigravity Mobile Remote] Extension activating...');

  // 1. Determine workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
    ? workspaceFolders[0].uri.fsPath
    : process.cwd();

  // 2. Instantiate Sidebar View Provider
  sidebarProvider = new SidebarViewProvider(
    context.extensionUri,
    () => companionServer,
    () => tunnelManager,
    () => sessionLifecycle
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      sidebarProvider
    )
  );

  // 3. Create Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'antigravityRemote.start';
  updateStatusBar(false);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 4. Set initial context key for menu actions
  vscode.commands.executeCommand('setContext', 'antigravityRemote:isRunning', false);

  // 5. Register Commands
  const startCmd = vscode.commands.registerCommand('antigravityRemote.start', async () => {
    if (isRunning) {
      vscode.window.showInformationMessage('Antigravity Remote Companion is already running.');
      return;
    }

    const config = vscode.workspace.getConfiguration('antigravityRemote');
    const port = config.get<number>('port', 39871);
    const preventSleep = config.get<boolean>('preventSleep', true);
    const botToken = config.get<string>('telegramBotToken', '');
    const chatId = config.get<string>('telegramChatId', '');

    // Ask user for session expiry duration
    const durationPick = await vscode.window.showQuickPick(
      [
        { label: '$(clock) 3 Hours', description: 'Recommended default', value: 3 },
        { label: '$(clock) 1 Hour', description: 'Quick check-in', value: 1 },
        { label: '$(clock) 8 Hours', description: 'Full work day', value: 8 },
        { label: '$(circle-slash) Indefinite', description: 'No expiry until stopped', value: 0 },
        { label: '$(edit) Custom duration...', description: 'Specify custom hours', value: -1 }
      ],
      { placeHolder: 'Select session expiry duration for the remote mobile tunnel' }
    );

    if (!durationPick) {
      return; // User cancelled prompt
    }

    let expiryHours = durationPick.value;
    if (expiryHours === -1) {
      const customInput = await vscode.window.showInputBox({
        prompt: 'Enter session duration in hours (e.g. 2, 4, 12):',
        validateInput: (val) => {
          const n = parseFloat(val);
          return isNaN(n) || n <= 0 ? 'Please enter a valid positive number' : null;
        }
      });
      if (!customInput) {
        return; // User cancelled custom input
      }
      expiryHours = parseFloat(customInput);
    }

    // Initialize Telegram notifier
    telegramNotifier = new TelegramNotifier({ botToken, chatId });
    console.log(`[Extension] Telegram configured: ${telegramNotifier.isConfigured()} (token: ${botToken ? 'SET' : 'EMPTY'}, chatId: ${chatId ? 'SET' : 'EMPTY'})`);

    try {
      updateStatusBar(true, 'Starting...');
      vscode.window.showInformationMessage(`Starting Antigravity Remote (${expiryHours > 0 ? `${expiryHours}h duration` : 'Indefinite'})...`);

      // A. Start HTTP & WebSocket Server
      companionServer = new MobileCompanionServer({
        port,
        workspaceRoot,
        expiryHours
      });
      const actualPort = await companionServer.start();

      // Hook socket events to sidebar
      companionServer.getSocketManager().on('client:connected', (data: any) => {
        console.log('[Extension] Mobile client connected:', data);
        sidebarProvider?.refresh();
      });
      companionServer.getSocketManager().on('client:disconnected', (deviceId: string) => {
        console.log('[Extension] Mobile client disconnected:', deviceId);
        sidebarProvider?.refresh();
      });

      // Global reference to the currently running child process for interactive stdin
      let activeChildProcess: cp.ChildProcess | null = null;

      companionServer.getSocketManager().on('client:request_models', async () => {
        try {
          const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
          const agyPath = path.join(localAppData, 'agy', 'bin', 'agy.exe');
          if (fs.existsSync(agyPath)) {
            cp.exec(`"${agyPath}" models`, (error, stdout) => {
              if (!error && stdout) {
                const models: {id: string, name: string}[] = [];
                const lines = stdout.split('\n');
                for (const line of lines) {
                  if (line.includes('\t')) {
                    const [id, ...nameParts] = line.split('\t');
                    models.push({ id: id.trim(), name: nameParts.join(' ').trim() });
                  }
                }
                if (models.length > 0) {
                  companionServer?.getSocketManager().broadcast('agent:models_list', models);
                }
              }
            });
          }
        } catch (e) {}
      });

      companionServer.getSocketManager().on('client:prompt', async (payload: any) => {
        const text = payload?.text || '';
        console.log('[Extension] Received prompt from mobile:', text);

        try {
          // If there's an active process running, we pipe the text into its stdin!
          // This allows the user to answer interactive prompts like [y/N]
          if (activeChildProcess && !activeChildProcess.killed) {
            console.log('[Extension] Piping input to active child process stdin');
            activeChildProcess.stdin?.write(text + '\n');
            
            // Echo the user's input to the chat UI stream so they see it locally
            companionServer?.getSocketManager().broadcast('agent:message', {
              content: `\n> ${text}\n`,
              delta: true
            });
            return;
          }

          const isNewChat = payload?.isNewChat !== false;
          const selectedModel = payload?.model || null;
          
          companionServer?.getSocketManager().broadcast('agent:status', {
            status: 'working',
            label: 'Agent processing...'
          });

          // Build path to agy.exe
          const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
          const agyPath = path.join(localAppData, 'agy', 'bin', 'agy.exe');

          if (!fs.existsSync(agyPath)) {
            throw new Error(`Antigravity CLI not found at ${agyPath}. Please install it.`);
          }

          const args = ['--print', text, '--print-timeout', '1h'];
          if (!isNewChat) {
            args.unshift('--continue');
          }
          if (selectedModel) {
            args.push('--model', selectedModel);
          }

          console.log(`[Extension] Spawning: ${agyPath} ${args.join(' ')}`);

          activeChildProcess = cp.spawn(agyPath, args, {
            cwd: workspaceRoot, // Use the dynamically resolved VS Code workspace root!
            windowsHide: true,
            env: process.env
          });

          let firstChunk = true;

          activeChildProcess.stdout?.on('data', (data) => {
            const chunk = data.toString();
            companionServer?.getSocketManager().broadcast('agent:message', {
              content: chunk,
              delta: !firstChunk
            });
            firstChunk = false;
          });

          activeChildProcess.stderr?.on('data', (data) => {
            console.log(`[agy stderr]: ${data.toString()}`);
          });

          activeChildProcess.on('close', (code) => {
            console.log(`[Extension] agy exited with code ${code}`);
            activeChildProcess = null; // Clear active process
            companionServer?.getSocketManager().broadcast('agent:status', {
              status: 'idle',
              label: 'Task Finished'
            });
            if (code !== 0) {
              companionServer?.getSocketManager().broadcast('agent:message', {
                content: `\n\n*(Process exited with error code ${code})*`,
                delta: true
              });
            }
          });

          activeChildProcess.on('error', (err) => {
            activeChildProcess = null;
            throw err;
          });

        } catch (e: any) {
          vscode.window.showErrorMessage(`Failed to route prompt: ${e.message || e}`);
          companionServer?.getSocketManager().broadcast('agent:status', {
            status: 'error',
            label: 'Failed to dispatch'
          });
          companionServer?.getSocketManager().broadcast('agent:message', {
            content: `❌ Error: ${e.message || e}`,
            delta: false
          });
        }

        // Send via Telegram if configured
        if (telegramNotifier?.isConfigured()) {
          telegramNotifier.sendAlert(
            'Mobile Message',
            `Message from mobile device: ${text}`
          );
        }
      });

      // Hook client:interrupt events
      companionServer.getSocketManager().on('client:interrupt', (payload: any) => {
        console.log('[Extension] Interrupt request from mobile:', payload);
        vscode.window.showWarningMessage('📱 Mobile requested agent interrupt.');
        companionServer?.getSocketManager().broadcast('agent:status', {
          status: 'idle',
          label: 'Interrupted'
        });
      });

      // B. Start Lifecycle & Keep-Awake
      sessionLifecycle = new SessionLifecycleManager();
      if (preventSleep) {
        sessionLifecycle.enableKeepAwake();
      }
      sessionLifecycle.on('tick', () => sidebarProvider?.refresh());
      sessionLifecycle.startSessionTimer(expiryHours, () => {
        vscode.window.showWarningMessage('Antigravity Remote session timer expired. Shutting down tunnel...');
        vscode.commands.executeCommand('antigravityRemote.stop');
      });

      isRunning = true;
      vscode.commands.executeCommand('setContext', 'antigravityRemote:isRunning', true);

      const pin = companionServer.getAuthManager().getPin();
      const token = companionServer.getAuthManager().getSessionToken();
      updateStatusBar(true, `Port ${actualPort} (PIN: ${pin})`);
      sidebarProvider?.refresh();

      // C. Start secure tunnel in background (Cloudflare → localtunnel fallback)
      const proxyUrl = config.get<string>('proxy') || vscode.workspace.getConfiguration('http').get<string>('proxy');
      tunnelManager = new TunnelManager(actualPort, context.globalStorageUri?.fsPath, proxyUrl);

      vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Connecting secure mobile tunnel...',
        cancellable: false
      }, async () => {
        try {
          const publicUrl = await tunnelManager!.start();
          const tunnelProvider = tunnelManager!.getProvider();
          // URL does NOT include token — user must enter PIN to authenticate
          const mobileUrl = publicUrl;
          updateStatusBar(true, `Online via ${tunnelProvider} (PIN: ${pin})`);
          sidebarProvider?.refresh();

          // Send Telegram notification if configured
          if (telegramNotifier?.isConfigured()) {
            console.log('[Extension] Sending Telegram notification...');
            const sent = await telegramNotifier.sendAlert(
              'Session Online',
              `Antigravity Remote started! PIN: ${pin}\nTunnel: ${tunnelProvider}\nOpen the link below on your phone to connect.`,
              mobileUrl
            );
            console.log(`[Extension] Telegram notification sent: ${sent}`);
            if (!sent) {
              vscode.window.showWarningMessage('Failed to send Telegram notification. Check your Bot Token and Chat ID in settings.');
            }
          }

          vscode.window.showInformationMessage(
            `Mobile Tunnel Online via ${tunnelProvider}! PIN: ${pin}`,
            'Copy Mobile URL',
            'Open in Browser',
            'Show Sidebar'
          ).then((selection) => {
            if (selection === 'Copy Mobile URL') {
              vscode.env.clipboard.writeText(mobileUrl);
              vscode.window.showInformationMessage('Mobile URL copied to clipboard! Open it on your phone and enter the PIN.');
            } else if (selection === 'Open in Browser') {
              vscode.env.openExternal(vscode.Uri.parse(mobileUrl));
            } else if (selection === 'Show Sidebar') {
              vscode.commands.executeCommand('workbench.view.extension.antigravity-remote-container');
            }
          });
        } catch (tunnelErr: any) {
          console.warn('[Extension] Tunnel failed, using local LAN fallback:', tunnelErr.message || tunnelErr);
          const localLanUrl = tunnelManager?.getLocalLanUrl() || `http://localhost:${actualPort}`;
          sidebarProvider?.refresh();

          // Even when tunnel fails, send Telegram notification with LAN URL
          if (telegramNotifier?.isConfigured()) {
            const sent = await telegramNotifier.sendAlert(
              'Session Online (Local Wi-Fi)',
              `Antigravity Remote started! PIN: ${pin}\nCloudflare tunnel unavailable. Connect via same Wi-Fi network.`,
              localLanUrl
            );
            console.log(`[Extension] Telegram (LAN fallback) sent: ${sent}`);
          }

          vscode.window.showWarningMessage(
            `Cloudflare tunnel unavailable: ${tunnelErr.message || tunnelErr}. Connect via same Wi-Fi: ${localLanUrl}`,
            'Copy Wi-Fi URL'
          ).then((sel) => {
            if (sel === 'Copy Wi-Fi URL') {
              vscode.env.clipboard.writeText(localLanUrl);
            }
          });
        }
      });
    } catch (err: any) {
      isRunning = false;
      vscode.commands.executeCommand('setContext', 'antigravityRemote:isRunning', false);
      updateStatusBar(false);
      sidebarProvider?.refresh();
      vscode.window.showErrorMessage(`Failed to start Mobile Companion: ${err.message || err}`);
    }
  });

  const stopCmd = vscode.commands.registerCommand('antigravityRemote.stop', async () => {
    if (!isRunning) {
      vscode.window.showInformationMessage('Antigravity Remote Companion is not running.');
      return;
    }

    try {
      if (tunnelManager) {
        tunnelManager.stop();
        tunnelManager = null;
      }
      if (sessionLifecycle) {
        sessionLifecycle.dispose();
        sessionLifecycle = null;
      }
      if (companionServer) {
        await companionServer.stop();
        companionServer = null;
      }

      isRunning = false;
      vscode.commands.executeCommand('setContext', 'antigravityRemote:isRunning', false);
      updateStatusBar(false);
      sidebarProvider?.refresh();
      vscode.window.showInformationMessage('Antigravity Remote Companion session stopped.');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error stopping session: ${err.message || err}`);
    }
  });

  const regenPinCmd = vscode.commands.registerCommand('antigravityRemote.regeneratePin', async () => {
    if (!companionServer) {
      vscode.window.showWarningMessage('Start the companion session first.');
      return;
    }
    const { pin } = companionServer.getAuthManager().regenerateCredentials();
    updateStatusBar(true, `PIN: ${pin}`);
    sidebarProvider?.refresh();
    vscode.window.showInformationMessage(`New 6-digit PIN generated: ${pin}`);
  });

  const openInBrowserCmd = vscode.commands.registerCommand('antigravityRemote.openInBrowser', async () => {
    if (!companionServer) {
      vscode.window.showWarningMessage('Start the companion session first.');
      return;
    }
    const port = companionServer.getPort();
    const publicUrl = tunnelManager?.getPublicUrl();
    // URL does NOT include token — user must authenticate via PIN
    const targetUrl = publicUrl || `http://localhost:${port}`;
    vscode.env.openExternal(vscode.Uri.parse(targetUrl));
  });

  context.subscriptions.push(startCmd, stopCmd, regenPinCmd, openInBrowserCmd);

  // 6. Auto-start if configured in settings
  const config = vscode.workspace.getConfiguration('antigravityRemote');
  if (config.get<boolean>('autoStartOnLaunch', false)) {
    vscode.commands.executeCommand('antigravityRemote.start');
  }

  console.log('[Antigravity Mobile Remote] Extension activated successfully.');
}

function updateStatusBar(active: boolean, statusText?: string) {
  if (active) {
    statusBarItem.text = `$(broadcast) Remote: ${statusText || 'Online'}`;
    statusBarItem.tooltip = 'Antigravity Mobile Remote is active. Click to stop.';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    statusBarItem.command = 'antigravityRemote.stop';
  } else {
    statusBarItem.text = '$(circle-slash) Remote: Offline';
    statusBarItem.tooltip = 'Click to start Antigravity Mobile Remote session.';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.command = 'antigravityRemote.start';
  }
}

export function deactivate() {
  console.log('[Antigravity Mobile Remote] Deactivating...');
  if (tunnelManager) {
    tunnelManager.stop();
  }
  if (sessionLifecycle) {
    sessionLifecycle.dispose();
  }
  if (companionServer) {
    companionServer.stop();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
