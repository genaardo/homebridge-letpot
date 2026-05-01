export interface AuthInfo {
  accessToken: string;
  accessTokenExpires: number;
  refreshToken: string;
  refreshTokenExpires: number;
  userId: string;
  email: string;
}

export interface LetPotDevice {
  serialNumber: string;
  name: string;
  deviceType: string;
  isOnline: boolean;
}

export const enum CycleWateringMode {
  CONTINUOUS = 0,
  INTERMITTENT = 1,
}

export const enum WateringReason {
  NO_RUN = 0,
  INTERRUPTED = 1,
  MANUAL = 2,
  CYCLE = 3,
  SCHEDULED = 4,
}

export interface DeviceErrors {
  lowWater: boolean;
}

export interface WateringSystemStatus {
  raw: number[];
  pumpMode: number;
  errors: DeviceErrors;
  wifiState: number;
  pumpOn: boolean;
  pumpManualDuration: number;
  pumpCycleOn: boolean;
  pumpCycleFrequency: number;
  pumpCycleDuration: number;
  pumpCycleMode: CycleWateringMode;
  pumpCycleWorkingInterval: number;
  pumpCycleRestInterval: number;
  pumpCycleSkipWater: number | null;
  pumpWorksEnd: Date | null;
  pumpWorksLatestReason: WateringReason;
  pumpWorksLatestTime: Date | null;
  pumpWorksNextTime: Date | null;
}
