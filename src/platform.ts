import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { LetPotApiClient } from './letpot-api';
import { LetPotMqttClient } from './letpot-mqtt';
import { WateringSystemAccessory } from './accessory';
import { LetPotDevice } from './models';

export class LetPotPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly accessories = new Map<string, WateringSystemAccessory>();

  private readonly apiClient: LetPotApiClient;
  public mqttClient!: LetPotMqttClient;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.apiClient = new LetPotApiClient(log);

    this.api.on('didFinishLaunching', () => {
      this.initialize().catch(err => {
        this.log.error('Failed to initialize LetPot platform:', (err as Error).message);
      });
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.push(accessory);
  }

  private async initialize(): Promise<void> {
    if (!this.config.email || !this.config.password) {
      this.log.error('LetPot email and password are required in config.json');
      return;
    }

    const authInfo = await this.apiClient.login(this.config.email as string, this.config.password as string);
    this.log.info('Logged in to LetPot account');

    this.mqttClient = new LetPotMqttClient(this.log, authInfo);
    this.mqttClient.connect();

    const devices = await this.apiClient.getDevices();
    this.log.info(`Found ${devices.length} LetPot device(s)`);

    const discoveredUuids = new Set<string>();

    for (const device of devices) {
      if (!this.isWateringSystem(device)) {
        this.log.debug(`Skipping unsupported device type: ${device.serialNumber} (${device.deviceType})`);
        continue;
      }
      this.setupDevice(device);
      discoveredUuids.add(this.api.hap.uuid.generate(device.serialNumber));
    }

    // Remove cached accessories that are no longer present
    for (const cached of this.cachedAccessories) {
      if (!discoveredUuids.has(cached.UUID)) {
        this.log.info(`Removing stale accessory: ${cached.displayName}`);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cached]);
      }
    }

    // Refresh the access token every 50 minutes to stay ahead of expiry
    setInterval(() => {
      this.apiClient.refreshToken().catch(err => {
        this.log.warn('LetPot token refresh failed:', (err as Error).message);
      });
    }, 50 * 60 * 1000);
  }

  private isWateringSystem(device: LetPotDevice): boolean {
    return device.serialNumber.startsWith('ISE05') || device.serialNumber.startsWith('ISE06');
  }

  private setupDevice(device: LetPotDevice): void {
    const uuid = this.api.hap.uuid.generate(device.serialNumber);
    const existing = this.cachedAccessories.find(a => a.UUID === uuid);

    let platformAccessory: PlatformAccessory;
    const isNew = !existing;

    if (existing) {
      existing.context.device = device;
      platformAccessory = existing;
    } else {
      platformAccessory = new this.api.platformAccessory(device.name, uuid);
      platformAccessory.context.device = device;
    }

    // Build all services onto the accessory BEFORE registering/updating so
    // Homebridge saves the complete service list and HomeKit gets the full
    // accessory definition in a single announcement.
    const acc = new WateringSystemAccessory(this, platformAccessory);
    this.accessories.set(device.serialNumber, acc);

    if (isNew) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
      this.log.info(`Registering new accessory: ${device.name}`);
    } else {
      this.api.updatePlatformAccessories([platformAccessory]);
      this.log.info(`Restoring accessory from cache: ${device.name}`);
    }

    this.mqttClient.subscribe(device.serialNumber, status => acc.updateStatus(status));

    // Ask the device to push its current state
    setTimeout(() => {
      this.mqttClient.requestStatus(device.serialNumber).catch(err => {
        this.log.warn(`Failed to request initial status for ${device.serialNumber}:`, (err as Error).message);
      });
    }, 3000);
  }
}
