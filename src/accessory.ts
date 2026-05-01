import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { LetPotPlatform } from './platform';
import { WateringSystemStatus } from './models';

export class WateringSystemAccessory {
  private valveService: Service;
  private leakService: Service;
  private status: WateringSystemStatus | null = null;

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

    // Valve service — maps scheduled watering mode to Active, pump running to InUse
    this.valveService = accessory.getService(Service.Valve)
      ?? accessory.addService(Service.Valve, device.name);

    this.valveService
      .setCharacteristic(Characteristic.Name, device.name)
      .setCharacteristic(Characteristic.ValveType, 1); // 1 = Irrigation

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

    // Leak sensor — surfaces the low water alert
    this.leakService = accessory.getService(Service.LeakSensor)
      ?? accessory.addService(Service.LeakSensor, 'Low Water', 'low-water');

    this.leakService.getCharacteristic(Characteristic.LeakDetected)
      .onGet(this.getLeakDetected.bind(this));
  }

  updateStatus(status: WateringSystemStatus): void {
    this.status = status;
    const { Characteristic } = this.platform;

    this.valveService.updateCharacteristic(
      Characteristic.Active, status.pumpMode > 0 ? 1 : 0,
    );
    this.valveService.updateCharacteristic(
      Characteristic.InUse, status.pumpOn ? 1 : 0,
    );
    this.valveService.updateCharacteristic(
      Characteristic.SetDuration, (status.pumpManualDuration || 0) * 60,
    );
    this.valveService.updateCharacteristic(
      Characteristic.RemainingDuration, this.computeRemainingSeconds(status),
    );
    this.leakService.updateCharacteristic(
      Characteristic.LeakDetected, status.errors.lowWater ? 1 : 0,
    );
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

  private getActive(): CharacteristicValue {
    return this.status ? (this.status.pumpMode > 0 ? 1 : 0) : 0;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    if (!this.status) {
      return;
    }
    const newStatus: WateringSystemStatus = { ...this.status, pumpMode: value === 1 ? 1 : 0 };
    await this.platform.mqttClient.publishStatus(this.serial, newStatus);
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
    const minutes = Math.floor((value as number) / 60);
    const newStatus: WateringSystemStatus = { ...this.status, pumpManualDuration: minutes };
    await this.platform.mqttClient.publishStatus(this.serial, newStatus);
  }

  private getRemainingDuration(): CharacteristicValue {
    return this.status ? this.computeRemainingSeconds(this.status) : 0;
  }

  private getLeakDetected(): CharacteristicValue {
    return this.status?.errors.lowWater ? 1 : 0;
  }
}
