import { Characteristic, CharacteristicValue, Formats, PlatformAccessory, Perms, Service } from 'homebridge';
import { LetPotPlatform } from './platform';
import { WateringSystemStatus } from './models';

// Custom characteristic UUIDs — visible in Eve and Home+, no effect on Apple Home
const UUID_LAST_WATERED    = 'A9E3F1B2-C4D5-4E6F-A7B8-C9D0E1F20001';
const UUID_NEXT_WATERING   = 'A9E3F1B2-C4D5-4E6F-A7B8-C9D0E1F20002';
const UUID_WATERING_REASON = 'A9E3F1B2-C4D5-4E6F-A7B8-C9D0E1F20003';

export class WateringSystemAccessory {
  private valveService: Service;
  private cycleWateringSwitch: Service;
  private leakService: Service;
  private wateringStartedSwitch: Service;
  private wateringEndedSwitch: Service;
  private lastWateredChar: Characteristic;
  private nextWateringChar: Characteristic;
  private wateringReasonChar: Characteristic;

  private status: WateringSystemStatus | null = null;
  private prevPumpOn: boolean | null = null;

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
    this.lastWateredChar = new Characteristic('Last Watered', UUID_LAST_WATERED, {
      format: Formats.UINT32, perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.nextWateringChar = new Characteristic('Next Watering', UUID_NEXT_WATERING, {
      format: Formats.UINT32, perms: [Perms.NOTIFY, Perms.PAIRED_READ],
    });
    this.wateringReasonChar = new Characteristic('Last Watering Reason', UUID_WATERING_REASON, {
      format: Formats.UINT8, perms: [Perms.NOTIFY, Perms.PAIRED_READ], minValue: 0, maxValue: 4,
    });
    this.valveService.addCharacteristic(this.lastWateredChar);
    this.valveService.addCharacteristic(this.nextWateringChar);
    this.valveService.addCharacteristic(this.wateringReasonChar);

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

    // --- Event switches (StatelessProgrammableSwitch) ---
    // Fire a single-press event on pump state transitions.
    // Users set up automations in the Home app (or Eve/Home+) to get notifications.
    // Note: Apple Home shows these as "#1" / "#2"; third-party apps show the full name.
    const serviceLabel = accessory.getService(Service.ServiceLabel)
      ?? accessory.addService(Service.ServiceLabel);
    serviceLabel.setCharacteristic(
      Characteristic.ServiceLabelNamespace,
      Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS,
    );

    this.wateringStartedSwitch = accessory.getServiceById(Service.StatelessProgrammableSwitch, 'watering-started')
      ?? accessory.addService(Service.StatelessProgrammableSwitch, 'Watering Started', 'watering-started');

    this.wateringStartedSwitch
      .setCharacteristic(Characteristic.Name, 'Watering Started')
      .setCharacteristic(Characteristic.ConfiguredName, 'Watering Started')
      .setCharacteristic(Characteristic.ServiceLabelIndex, 1);

    this.wateringStartedSwitch.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .setProps({ validValues: [Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS] });

    this.wateringEndedSwitch = accessory.getServiceById(Service.StatelessProgrammableSwitch, 'watering-ended')
      ?? accessory.addService(Service.StatelessProgrammableSwitch, 'Watering Ended', 'watering-ended');

    this.wateringEndedSwitch
      .setCharacteristic(Characteristic.Name, 'Watering Ended')
      .setCharacteristic(Characteristic.ConfiguredName, 'Watering Ended')
      .setCharacteristic(Characteristic.ServiceLabelIndex, 2);

    this.wateringEndedSwitch.getCharacteristic(Characteristic.ProgrammableSwitchEvent)
      .setProps({ validValues: [Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS] });
  }

  updateStatus(status: WateringSystemStatus): void {
    const { Characteristic } = this.platform;

    // Detect pump on/off transitions and fire the appropriate event switch
    if (this.prevPumpOn !== null && status.pumpOn !== this.prevPumpOn) {
      const eventSwitch = status.pumpOn ? this.wateringStartedSwitch : this.wateringEndedSwitch;
      eventSwitch.updateCharacteristic(
        Characteristic.ProgrammableSwitchEvent,
        Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS,
      );
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
