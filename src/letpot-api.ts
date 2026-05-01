import { Logger } from 'homebridge';
import { AuthInfo, LetPotDevice } from './models';

const API_BASE = 'https://api.letpot.net/app/';

export class LetPotApiClient {
  private authInfo: AuthInfo | null = null;

  constructor(private readonly log: Logger) {}

  async login(email: string, password: string): Promise<AuthInfo> {
    const body = new URLSearchParams({
      loginType: 'EMAIL',
      email,
      password,
      refresh_token: '',
    });

    const response = await fetch(API_BASE + 'auth/login', { method: 'POST', body });

    if (response.status === 403) {
      throw new Error('Invalid LetPot credentials');
    }

    const json = await response.json() as Record<string, unknown>;
    if (!json['ok']) {
      throw new Error(`Login failed: ${json['message']}`);
    }

    const data = json['data'] as Record<string, unknown>;
    const token = data['token'] as Record<string, unknown>;
    const refreshToken = data['refreshToken'] as Record<string, unknown>;

    this.authInfo = {
      accessToken: token['token'] as string,
      accessTokenExpires: token['exp'] as number,
      refreshToken: refreshToken['token'] as string,
      refreshTokenExpires: refreshToken['exp'] as number,
      userId: data['user_id'] as string,
      email: email.toLowerCase(),
    };

    return this.authInfo;
  }

  async refreshToken(): Promise<AuthInfo> {
    if (!this.authInfo?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(API_BASE + 'auth/refresh', {
      headers: { 'Rfs-Authorization': this.authInfo.refreshToken },
    });

    if (response.status === 401) {
      throw new Error('Refresh token rejected — please re-enter credentials');
    }

    const json = await response.json() as Record<string, unknown>;
    if (!json['ok']) {
      throw new Error(`Token refresh failed: ${json['message']}`);
    }

    const data = json['data'] as Record<string, unknown>;
    const token = data['token'] as Record<string, unknown>;
    const refreshToken = data['refreshToken'] as Record<string, unknown>;

    this.authInfo = {
      ...this.authInfo,
      accessToken: token['token'] as string,
      accessTokenExpires: token['exp'] as number,
      refreshToken: refreshToken['token'] as string,
      refreshTokenExpires: refreshToken['exp'] as number,
    };

    return this.authInfo;
  }

  async ensureValidToken(): Promise<void> {
    if (!this.authInfo) {
      throw new Error('Not authenticated');
    }
    // Refresh if the token expires within the next 60 seconds
    if (this.authInfo.accessTokenExpires < Date.now() / 1000 + 60) {
      this.log.debug('Access token expiring soon, refreshing...');
      await this.refreshToken();
    }
  }

  async getDevices(): Promise<LetPotDevice[]> {
    await this.ensureValidToken();

    const response = await fetch(API_BASE + 'devices', {
      headers: {
        'Authorization': this.authInfo!.accessToken,
        'uid': this.authInfo!.userId,
      },
    });

    if (response.status === 401) {
      throw new Error('Authentication error fetching devices');
    }

    const json = await response.json() as Record<string, unknown>;
    const devices = json['data'] as Record<string, unknown>[];

    return devices.map(d => ({
      serialNumber: d['sn'] as string,
      name: d['name'] as string,
      deviceType: d['dev_type'] as string,
      isOnline: d['is_online'] as boolean,
    }));
  }

  getAuthInfo(): AuthInfo | null {
    return this.authInfo;
  }
}
