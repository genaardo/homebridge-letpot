import { createHash } from 'crypto';
import { Logger } from 'homebridge';
import * as mqtt from 'mqtt';
import { buildStatusRequestMessage, buildUpdateMessage, parseWateringSystemStatus } from './converters';
import { AuthInfo, WateringSystemStatus } from './models';

const BROKER_URL = 'wss://broker.letpot.net:443/mqttwss';

export type StatusCallback = (status: WateringSystemStatus) => void;

export class LetPotMqttClient {
  private client: mqtt.MqttClient | null = null;
  private messageId = 0;
  private subscriptions = new Map<string, StatusCallback>();

  constructor(
    private readonly log: Logger,
    private readonly authInfo: AuthInfo,
  ) {}

  connect(): void {
    const username = `${this.authInfo.email}__letpot_v3`;
    const password = createHash('sha256')
      .update(`${this.authInfo.userId}|${createHash('md5').update(username).digest('hex')}`)
      .digest('hex');

    const clientId = `LetPot_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

    this.log.debug('Connecting to LetPot MQTT broker');
    this.client = mqtt.connect(BROKER_URL, {
      username,
      password,
      clientId,
      protocolVersion: 5,
      rejectUnauthorized: true,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      this.log.debug('Connected to LetPot MQTT broker');
      this.messageId = 0;
      for (const serial of this.subscriptions.keys()) {
        this.client!.subscribe(`${serial}/data`, err => {
          if (err) {
            this.log.warn(`Failed to re-subscribe to ${serial}/data:`, err.message);
          }
        });
      }
    });

    this.client.on('message', (topic, payload) => {
      const serial = topic.split('/')[0];
      const callback = this.subscriptions.get(serial);
      if (!callback) {
        return;
      }
      try {
        const status = parseWateringSystemStatus(payload, serial);
        if (status) {
          callback(status);
        }
      } catch (err) {
        this.log.warn(`Failed to parse MQTT message from ${serial}:`, (err as Error).message);
      }
    });

    this.client.on('error', err => {
      this.log.error('LetPot MQTT error:', err.message);
    });

    this.client.on('offline', () => {
      this.log.debug('LetPot MQTT client offline, will reconnect automatically');
    });

    this.client.on('reconnect', () => {
      this.log.debug('LetPot MQTT reconnecting...');
    });
  }

  subscribe(serial: string, callback: StatusCallback): void {
    this.subscriptions.set(serial, callback);
    if (this.client?.connected) {
      this.client.subscribe(`${serial}/data`, err => {
        if (err) {
          this.log.warn(`Failed to subscribe to ${serial}/data:`, err.message);
        } else {
          this.log.debug(`Subscribed to ${serial}/data`);
        }
      });
    }
  }

  unsubscribe(serial: string): void {
    this.subscriptions.delete(serial);
    this.client?.unsubscribe(`${serial}/data`);
  }

  requestStatus(serial: string): Promise<void> {
    return this.publish(serial, buildStatusRequestMessage());
  }

  publishStatus(serial: string, status: WateringSystemStatus): Promise<void> {
    return this.publish(serial, buildUpdateMessage(status));
  }

  disconnect(): void {
    this.client?.end();
    this.client = null;
  }

  private publish(serial: string, message: number[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client?.connected) {
        return reject(new Error('MQTT client not connected'));
      }
      const packet = this.buildPacket(message);
      this.client.publish(`${serial}/cmd`, packet, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Wraps the message in the LetPot wire format and hex-encodes it.
  // maintype=1 (data), subtype=19 (custom) — same for all LetPot commands.
  private buildPacket(message: number[]): string {
    const MAINTYPE = 1;
    const SUBTYPE = 19;
    const packet = [
      (SUBTYPE << 2) | MAINTYPE, // 0x4d = 77
      0,
      this.messageId++ & 0xff,
      message.length,
      ...message,
    ];
    return packet.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
