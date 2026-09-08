import * as crypto from 'crypto';

export interface ConnectedDevice {
  id: string;
  userAgent: string;
  ip: string;
  connectedAt: number;
  lastActiveAt: number;
}

export interface AuthState {
  sessionToken: string;
  pin: string;
  createdAt: number;
  expiresAt: number | null;
  devices: Map<string, ConnectedDevice>;
}

export class AuthManager {
  private sessionToken: string;
  private pin: string;
  private createdAt: number;
  private expiresAt: number | null = null;
  private devices: Map<string, ConnectedDevice> = new Map();
  private failedAttempts = 0;
  private lockedUntil = 0;

  constructor(expiryHours: number = 3) {
    this.sessionToken = this.generateToken();
    this.pin = this.generatePin();
    this.createdAt = Date.now();
    if (expiryHours > 0) {
      this.expiresAt = this.createdAt + expiryHours * 60 * 60 * 1000;
    }
  }

  public generateToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  public generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  public regenerateCredentials(expiryHours: number = 3): { token: string; pin: string } {
    this.sessionToken = this.generateToken();
    this.pin = this.generatePin();
    this.createdAt = Date.now();
    this.devices.clear();
    this.failedAttempts = 0;
    this.lockedUntil = 0;
    if (expiryHours > 0) {
      this.expiresAt = this.createdAt + expiryHours * 60 * 60 * 1000;
    } else {
      this.expiresAt = null;
    }
    return { token: this.sessionToken, pin: this.pin };
  }

  public getSessionToken(): string {
    return this.sessionToken;
  }

  public getPin(): string {
    return this.pin;
  }

  public getExpiresAt(): number | null {
    return this.expiresAt;
  }

  public extendExpiry(additionalHours: number = 1): number | null {
    if (this.expiresAt === null) {
      return null;
    }
    const base = Math.max(Date.now(), this.expiresAt);
    this.expiresAt = base + additionalHours * 60 * 60 * 1000;
    return this.expiresAt;
  }

  public isExpired(): boolean {
    if (this.expiresAt === null) {
      return false;
    }
    return Date.now() > this.expiresAt;
  }

  public verifyToken(token: string | undefined): boolean {
    if (!token || this.isExpired()) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(this.sessionToken)
      );
    } catch {
      return false;
    }
  }

  public verifyPin(pin: string): { success: boolean; token?: string; error?: string } {
    if (Date.now() < this.lockedUntil) {
      const waitSeconds = Math.ceil((this.lockedUntil - Date.now()) / 1000);
      return {
        success: false,
        error: `Too many failed attempts. Try again in ${waitSeconds} seconds.`
      };
    }

    if (this.isExpired()) {
      return { success: false, error: 'Session has expired.' };
    }

    if (pin.trim() === this.pin) {
      this.failedAttempts = 0;
      return { success: true, token: this.sessionToken };
    }

    this.failedAttempts++;
    if (this.failedAttempts >= 5) {
      this.lockedUntil = Date.now() + 5 * 60 * 1000; // 5-minute lockout
      return {
        success: false,
        error: 'Too many incorrect attempts. Locked out for 5 minutes.'
      };
    }

    const remaining = 5 - this.failedAttempts;
    return {
      success: false,
      error: `Incorrect PIN. ${remaining} attempts remaining.`
    };
  }

  public registerDevice(deviceId: string, userAgent: string, ip: string): ConnectedDevice {
    const existing = this.devices.get(deviceId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      existing.ip = ip;
      return existing;
    }
    const device: ConnectedDevice = {
      id: deviceId,
      userAgent: userAgent || 'Mobile Device',
      ip: ip || 'unknown',
      connectedAt: Date.now(),
      lastActiveAt: Date.now()
    };
    this.devices.set(deviceId, device);
    return device;
  }

  public updateDeviceActivity(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastActiveAt = Date.now();
    }
  }

  public removeDevice(deviceId: string): boolean {
    return this.devices.delete(deviceId);
  }

  public clearAllDevices(): void {
    this.devices.clear();
  }

  public getConnectedDevices(): ConnectedDevice[] {
    return Array.from(this.devices.values());
  }
}
