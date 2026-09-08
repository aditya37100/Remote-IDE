import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import { EventEmitter } from 'events';

export class SessionLifecycleManager extends EventEmitter {
  private expiryTimer: NodeJS.Timeout | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private keepAwakeProcess: ChildProcess | null = null;
  private expiresAt: number | null = null;
  private isKeepAwakeActive = false;

  constructor() {
    super();
  }

  /**
   * Starts countdown timer and emits tick every 10 seconds.
   */
  public startSessionTimer(expiryHours: number, onExpire: () => void): void {
    this.stopSessionTimer();

    if (expiryHours <= 0) {
      this.expiresAt = null;
      return;
    }

    this.expiresAt = Date.now() + expiryHours * 60 * 60 * 1000;

    this.tickInterval = setInterval(() => {
      const remainingMs = this.getRemainingMs();
      if (remainingMs !== null) {
        this.emit('tick', { remainingMs });
        if (remainingMs <= 0) {
          this.stopSessionTimer();
          this.emit('expired');
          onExpire();
        }
      }
    }, 10000);
  }

  public getRemainingMs(): number | null {
    if (this.expiresAt === null) {
      return null;
    }
    return Math.max(0, this.expiresAt - Date.now());
  }

  public extend(additionalHours: number = 1): number | null {
    if (this.expiresAt === null) {
      return null;
    }
    this.expiresAt += additionalHours * 60 * 60 * 1000;
    return this.expiresAt;
  }

  public stopSessionTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.expiresAt = null;
  }

  /**
   * Prevents Windows / OS from going to sleep while active.
   */
  public enableKeepAwake(): void {
    if (this.isKeepAwakeActive) {
      return;
    }

    if (os.platform() === 'win32') {
      try {
        // Windows API: SetThreadExecutionState ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED
        const psScript = `
          $code = @'
          [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
          public static extern uint SetThreadExecutionState(uint esFlags);
          '@
          $ste = Add-Type -MemberDefinition $code -Name "Win32STE" -Namespace "Win32" -PassThru
          # 0x80000001 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED
          [Win32.Win32STE]::SetThreadExecutionState(0x80000001)
          while ($true) { Start-Sleep -Seconds 60 }
        `;

        this.keepAwakeProcess = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
          windowsHide: true
        });

        this.isKeepAwakeActive = true;
        console.log('[SessionLifecycleManager] Windows sleep prevention active.');
      } catch (err) {
        console.warn('[SessionLifecycleManager] Failed to start keep-awake process:', err);
      }
    }
  }

  public disableKeepAwake(): void {
    if (this.keepAwakeProcess) {
      try {
        if (os.platform() === 'win32') {
          spawn('taskkill', ['/pid', this.keepAwakeProcess.pid!.toString(), '/f', '/t']);
        } else {
          this.keepAwakeProcess.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
      this.keepAwakeProcess = null;
    }
    this.isKeepAwakeActive = false;
    console.log('[SessionLifecycleManager] Keep-awake deactivated.');
  }

  public dispose(): void {
    this.stopSessionTimer();
    this.disableKeepAwake();
  }
}
