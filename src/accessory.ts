import { Characteristic, CharacteristicValue, Formats, PlatformAccessory, Perms, Service } from 'homebridge';
import { LetPotPlatform } from './platform';
import { WateringSystemStatus } from './models';

// Custom characteristic UUIDs — visible in Eve and Home+, no effect on Apple Home
const UUID_LAST_WATERED    = 'A9E3F1B2-C4D5-4E6F-A7B8-C9D0E1F20001';
const UUID_NEXT_WATERING   = 'A9E3F1B2-C4D5-4E6F-A7B8-C9D0E1F20002';
const UUID_WATERING_REASON = 'A9E3F1B2-C4D5-4E6F-A7B8-C9D0E1F20003';

// How long the occupancy sensors stay triggered before auto-resetting (ms)
const NOTIFICATION_RESET_MS = 5000;

export class WateringSystemAccessory {
  private valveService: Service;
  private cycleWateringSwitch: Service;
  private leakService: Service;
  private wateringStartedSensor: Service;
  private wateringEndedSensor: Service;
  private lastWateredChar: Characteristic;
  private nextWateringChar: Characteristic;
  private wateringReasonChar: Characteristic;

  private status: WateringSystemStatus | null = null;
  private prevPumpOn: boolean | null = null;
  private wateringStartedResetTimer: ReturnType<typeof setTimeout> | null = null;
  private wateringEndedResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly platform: LetPotPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = platform;
    const device = accessory.context.device;

    // --- Migrate stale services from previous plugin versions ---
    this.removeStaleService(Service.MotionSensor, 'pump-started');
    this.removeStaleService(Service.MotionSensor, 'pump-stopped');
    this.removeStaleService(Service.Switch, 'intermittent-mode');
    this.removeStaleService(Service.Switch, 'auto-cycle');
    this.removeStaleService(Service.StatelessProgrammableSwitch, 'watering-started');
    this.removeStaleService(Service.StatelessProgrammableSwitch, 'watering-ended');
    const staleServiceLabel = this.accessory.getService(Service.ServiceLabel);
    if (staleServiceLabel) {
      this.accessory.removeService(staleServiceLabel);
    }

    // --- Accessory information ---
    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'LetPot')
      .setCharacteristic(Characteristic.Model, device.deviceType)
      .setCharacteristic(Characteristic.SerialNumber, device.serialNumber);

    // --- Pump (Valve) ---
    // Active  → pump on/off (pump_mode)
    // InUse   → pump currently running (pump_on)
    // SetDuration / RemainingDuration → manual run timing
    this.valveService = accessory.getService(Service.Valve)
      ?? accessory.addService(Service.Valve, 'Pump', 'pump');

    this.valveService
      .setCharacteristic(Characteristic.Name, 'Pump')
      .setCharacteristic(Characteristic.ConfiguredName, 'Pump')
      .setCharacteristic(Characteristic.ValveType, 1); // Irrigation

    this.valveService.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.valveService.getCharacteristic(Characteristic.InUse)
      .onGet(this.getInUse.bind(this));

    this.valveService.getCharacteristic(Characteristic.SetDuration)
      .onGet(this.getSetDuration.bind(this))
      .onSet(this.setSetDuration.bind(this));

    this.valveService.getCharacteristic(Characteristic.RemainingDuration)
      .onGet(this.getRemainingDuration.bind(this));

    // --- Custom characteristics (Eve / Home+ only) ---
    // Unix timestamps (uint32, seconds since 1970). Apple Home ignores unknown UUIDs.
    this.lastWateredChar = this.getOrAddCharacteristic(
      this.valveService, 'Last Watered', UUID_LAST_WATERED,
      { format: Formats.UINT32, perms: [Perms.NOTIFY, Perms.PAIRED_READ] },
    );
    this.nextWateringChar = this.getOrAddCharacteristic(
      this.valveService, 'Next Watering', UUID_NEXT_WATERING,
      { format: Formats.UINT32, perms: [Perms.NOTIFY, Perms.PAIRED_READ] },
    );
    this.wateringReasonChar = this.getOrAddCharacteristic(
      this.valveService, 'Last Watering Reason', UUID_WATERING_REASON,
      { format: Formats.UINT8, perms: [Perms.NOTIFY, Perms.PAIRED_READ], minValue: 0, maxValue: 4 },
    );

    // --- Cycle Watering (Switch) ---
    // Matches the "Cycle Watering" toggle in the LetPot app (pump_cycle_on)
    this.cycleWateringSwitch = accessory.getServiceById(Service.Switch, 'cycle-watering')
      ?? accessory.addService(Service.Switch, 'Cycle Watering', 'cycle-watering');

    this.cycleWateringSwitch
      .setCharacteristic(Characteristic.Name, 'Cycle Watering')
      .setCharacteristic(Characteristic.ConfiguredName, 'Cycle Watering');

    this.cycleWateringSwitch.getCharacteristic(Characteristic.On)
      .onGet(this.getCycleWatering.bind(this))
      .onSet(this.setCycleWatering.bind(this));

    // --- Low Water (Leak Sensor) ---
    // Persistent state — stays triggered until tank is refilled
    this.leakService = accessory.getServiceById(Service.LeakSensor, 'low-water')
      ?? accessory.addService(Service.LeakSensor, 'Low Water', 'low-water');

    this.leakService
      .setCharacteristic(Characteristic.Name, 'Low Water')
      .setCharacteristic(Characteristic.ConfiguredName, 'Low Water');

    this.leakService.getCharacteristic(Characteristic.LeakDetected)
      .onGet(this.getLeakDetected.bind(this));

    // --- Watering Started / Ended (OccupancySensor) ---
    // Briefly triggers on pump state transitions so users can enable native Home app
    // notifications without needing Shortcuts. Auto-resets after NOTIFICATION_RESET_MS.
    this.wateringStartedSensor = accessory.getServiceById(Service.OccupancySensor, 'watering-started')
      ?? accessory.addService(Service.OccupancySensor, 'Watering Started', 'watering-started');

    this.wateringStartedSensor
      .setCharacteristic(Characteristic.Name, 'Watering Started')
      .setCharacteristic(Characteristic.ConfiguredName, 'Watering Started');

    this.wateringEndedSensor = accessory.getServiceById(Service.OccupancySensor, 'watering-ended')
      ?? accessory.addService(Service.OccupancySensor, 'Watering Ended', 'watering-ended');

    this.wateringEndedSensor
      .setCharacteristic(Characteristic.Name, 'Watering Ended')
      .setCharacteristic(Characteristic.ConfiguredName, 'Watering Ended');
  }

  updateStatus(status: WateringSystemStatus): void {
    const { Characteristic } = this.platform;

    // Detect pump on/off transitions and briefly trigger the appropriate sensor
    if (this.prevPumpOn !== null && status.pumpOn !== this.prevPumpOn) {
      if (status.pumpOn) {
        this.triggerSensor(this.wateringStartedSensor, 'wateringStartedResetTimer');
      } else {
        this.triggerSensor(this.wateringEndedSensor, 'wateringEndedResetTimer');
      }
    }
    this.prevPumpOn = status.pumpOn;
    this.status = status;

    this.valveService.updateCharacteristic(Characteristic.Active, status.pumpMode > 0 ? 1 : 0);
    this.valveService.updateCharacteristic(Characteristic.InUse, status.pumpOn ? 1 : 0);
    this.valveService.updateCharacteristic(Characteristic.SetDuration, (status.pumpManualDuration || 0) * 60);
    this.valveService.updateCharacteristic(Characteristic.RemainingDuration, this.computeRemainingSeconds(status));

    this.cycleWateringSwitch.updateCharacteristic(Characteristic.On, status.pumpCycleOn);
    this.leakService.updateCharacteristic(Characteristic.LeakDetected, status.errors.lowWater ? 1 : 0);

    this.lastWateredChar.updateValue(
      status.pumpWorksLatestTime ? Math.floor(status.pumpWorksLatestTime.getTime() / 1000) : 0,
    );
    this.nextWateringChar.updateValue(
      status.pumpWorksNextTime ? Math.floor(status.pumpWorksNextTime.getTime() / 1000) : 0,
    );
    this.wateringReasonChar.updateValue(status.pumpWorksLatestReason);
  }

  private triggerSensor(sensor: Service, timerKey: 'wateringStartedResetTimer' | 'wateringEndedResetTimer'): void {
    const { Characteristic } = this.platform;
    if (this[timerKey]) {
      clearTimeout(this[timerKey]!);
    }
    sensor.updateCharacteristic(
      Characteristic.OccupancyDetected,
      Characteristic.OccupancyDetected.OCCUPANCY_DETECTED,
    );
    this[timerKey] = setTimeout(() => {
      sensor.updateCharacteristic(
        Characteristic.OccupancyDetected,
        Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
      this[timerKey] = null;
    }, NOTIFICATION_RESET_MS);
  }

  private getOrAddCharacteristic(
    service: Service,
    name: string,
    uuid: string,
    props: ConstructorParameters<typeof Characteristic>[2],
  ): Characteristic {
    return service.characteristics.find(c => c.UUID === uuid)
      ?? (() => {
        const char = new this.platform.Characteristic(name, uuid, props);
        service.addCharacteristic(char);
        return char;
      })();
  }

  private removeStaleService(serviceType: typeof Service.prototype.constructor, subtype: string): void {
    const stale = this.accessory.getServiceById(serviceType as never, subtype);
    if (stale) {
      this.platform.log.debug(`Removing stale service: ${subtype}`);
      this.accessory.removeService(stale);
    }
  }

  private computeRemainingSeconds(status: WateringSystemStatus): number {
    if (!status.pumpWorksEnd) {
      return 0;
    }
    return Math.max(0, Math.floor((status.pumpWorksEnd.getTime() - Date.now()) / 1000));
  }

  private get serial(): string {
    return this.accessory.context.device.serialNumber;
  }

  // --- Pump (Valve) ---

  private getActive(): CharacteristicValue {
    return this.status ? (this.status.pumpMode > 0 ? 1 : 0) : 0;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    if (!this.status) {
      return;
    }
    await this.platform.mqttClient.publishStatus(this.serial, { ...this.status, pumpMode: value === 1 ? 1 : 0 });
  }

  private getInUse(): CharacteristicValue {
    return this.status?.pumpOn ? 1 : 0;
  }

  private getSetDuration(): CharacteristicValue {
    return (this.status?.pumpManualDuration || 0) * 60;
  }

  private async setSetDuration(value: CharacteristicValue): Promise<void> {
    if (!this.status) {
      return;
    }
    await this.platform.mqttClient.publishStatus(
      this.serial, { ...this.status, pumpManualDuration: Math.floor((value as number) / 60) },
    );
  }

  private getRemainingDuration(): CharacteristicValue {
    return this.status ? this.computeRemainingSeconds(this.status) : 0;
  }

  // --- Cycle Watering ---

  private getCycleWatering(): CharacteristicValue {
    return this.status?.pumpCycleOn ?? false;
  }

  private async setCycleWatering(value: CharacteristicValue): Promise<void> {
    if (!this.status) {
      return;
    }
    await this.platform.mqttClient.publishStatus(this.serial, { ...this.status, pumpCycleOn: value as boolean });
  }

  // --- Low Water ---

  private getLeakDetected(): CharacteristicValue {
    return this.status?.errors.lowWater ? 1 : 0;
  }
}
