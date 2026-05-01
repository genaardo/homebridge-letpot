import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { LetPotPlatform } from './platform';
import { CycleWateringMode, WateringSystemStatus } from './models';

export class WateringSystemAccessory {
  private valveService: Service;
  private cycleSwitch: Service;
  private intermittentSwitch: Service;
  private leakService: Service;
  private pumpStartedSensor: Service | null = null;
  private pumpStoppedSensor: Service | null = null;

  private status: WateringSystemStatus | null = null;
  private prevPumpOn: boolean | null = null;

  constructor(
    private readonly platform: LetPotPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const { Service, Characteristic } = platform;
    const device = accessory.context.device;

    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'LetPot')
      .setCharacteristic(Characteristic.Model, device.deviceType)
      .setCharacteristic(Characteristic.SerialNumber, device.serialNumber);

    // Valve — scheduled watering on/off, running status, duration
    this.valveService = accessory.getService(Service.Valve)
      ?? accessory.addService(Service.Valve, device.name);

    this.valveService
      .setCharacteristic(Characteristic.Name, device.name)
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

    // Auto Cycle switch — enables/disables the automated cycling schedule
    this.cycleSwitch = accessory.getServiceById(Service.Switch, 'auto-cycle')
      ?? accessory.addService(Service.Switch, 'Auto Cycle', 'auto-cycle');

    this.cycleSwitch.setCharacteristic(Characteristic.Name, 'Auto Cycle');
    this.cycleSwitch.getCharacteristic(Characteristic.On)
      .onGet(this.getCycleOn.bind(this))
      .onSet(this.setCycleOn.bind(this));

    // Intermittent Mode switch — continuous vs. intermittent cycle
    this.intermittentSwitch = accessory.getServiceById(Service.Switch, 'intermittent-mode')
      ?? accessory.addService(Service.Switch, 'Intermittent Mode', 'intermittent-mode');

    this.intermittentSwitch.setCharacteristic(Characteristic.Name, 'Intermittent Mode');
    this.intermittentSwitch.getCharacteristic(Characteristic.On)
      .onGet(this.getIntermittentMode.bind(this))
      .onSet(this.setIntermittentMode.bind(this));

    // Low Water leak sensor
    this.leakService = accessory.getService(Service.LeakSensor)
      ?? accessory.addService(Service.LeakSensor, 'Low Water', 'low-water');

    this.leakService.getCharacteristic(Characteristic.LeakDetected)
      .onGet(this.getLeakDetected.bind(this));

    // Pump Started motion sensor — briefly triggers when the pump turns on.
    // Enable notifications in the Home app on this sensor for pump-on alerts.
    // Controlled by notifyPumpOn in config (default: true).
    const existingStarted = accessory.getServiceById(Service.MotionSensor, 'pump-started');
    if (platform.config['notifyPumpOn'] !== false) {
      this.pumpStartedSensor = existingStarted
        ?? accessory.addService(Service.MotionSensor, 'Pump Started', 'pump-started');
      this.pumpStartedSensor.setCharacteristic(Characteristic.Name, 'Pump Started');
      this.pumpStartedSensor.getCharacteristic(Characteristic.MotionDetected).onGet(() => false);
    } else if (existingStarted) {
      accessory.removeService(existingStarted);
    }

    // Pump Stopped motion sensor — briefly triggers when the pump turns off.
    // Controlled by notifyPumpOff in config (default: true).
    const existingStopped = accessory.getServiceById(Service.MotionSensor, 'pump-stopped');
    if (platform.config['notifyPumpOff'] !== false) {
      this.pumpStoppedSensor = existingStopped
        ?? accessory.addService(Service.MotionSensor, 'Pump Stopped', 'pump-stopped');
      this.pumpStoppedSensor.setCharacteristic(Characteristic.Name, 'Pump Stopped');
      this.pumpStoppedSensor.getCharacteristic(Characteristic.MotionDetected).onGet(() => false);
    } else if (existingStopped) {
      accessory.removeService(existingStopped);
    }
  }

  updateStatus(status: WateringSystemStatus): void {
    const { Characteristic } = this.platform;

    // Fire notification sensors on pump state transitions
    if (this.prevPumpOn !== null && status.pumpOn !== this.prevPumpOn) {
      if (status.pumpOn && this.pumpStartedSensor) {
        this.triggerMotionSensor(this.pumpStartedSensor);
      } else if (!status.pumpOn && this.pumpStoppedSensor) {
        this.triggerMotionSensor(this.pumpStoppedSensor);
      }
    }
    this.prevPumpOn = status.pumpOn;
    this.status = status;

    this.valveService.updateCharacteristic(Characteristic.Active, status.pumpMode > 0 ? 1 : 0);
    this.valveService.updateCharacteristic(Characteristic.InUse, status.pumpOn ? 1 : 0);
    this.valveService.updateCharacteristic(Characteristic.SetDuration, (status.pumpManualDuration || 0) * 60);
    this.valveService.updateCharacteristic(Characteristic.RemainingDuration, this.computeRemainingSeconds(status));

    this.cycleSwitch.updateCharacteristic(Characteristic.On, status.pumpCycleOn);
    this.intermittentSwitch.updateCharacteristic(
      Characteristic.On, status.pumpCycleMode === CycleWateringMode.INTERMITTENT,
    );

    this.leakService.updateCharacteristic(Characteristic.LeakDetected, status.errors.lowWater ? 1 : 0);
  }

  // Pulses MotionDetected true for 5 s then resets — enough for Home app to send a notification.
  private triggerMotionSensor(sensor: Service): void {
    sensor.updateCharacteristic(this.platform.Characteristic.MotionDetected, true);
    setTimeout(() => {
      sensor.updateCharacteristic(this.platform.Characteristic.MotionDetected, false);
    }, 5000);
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

  // --- Valve ---

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

  // --- Auto Cycle switch ---

  private getCycleOn(): CharacteristicValue {
    return this.status?.pumpCycleOn ?? false;
  }

  private async setCycleOn(value: CharacteristicValue): Promise<void> {
    if (!this.status) {
      return;
    }
    await this.platform.mqttClient.publishStatus(this.serial, { ...this.status, pumpCycleOn: value as boolean });
  }

  // --- Intermittent Mode switch ---

  private getIntermittentMode(): CharacteristicValue {
    return this.status?.pumpCycleMode === CycleWateringMode.INTERMITTENT;
  }

  private async setIntermittentMode(value: CharacteristicValue): Promise<void> {
    if (!this.status) {
      return;
    }
    await this.platform.mqttClient.publishStatus(this.serial, {
      ...this.status,
      pumpCycleMode: value ? CycleWateringMode.INTERMITTENT : CycleWateringMode.CONTINUOUS,
    });
  }

  // --- Leak sensor ---

  private getLeakDetected(): CharacteristicValue {
    return this.status?.errors.lowWater ? 1 : 0;
  }
}
