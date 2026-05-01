import { CycleWateringMode, WateringReason, WateringSystemStatus } from './models';

function hexToIntArray(payload: Buffer): number[] | null {
  try {
    const hex = payload.toString('utf-8');
    const result: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      result.push(parseInt(hex.slice(i, i + 2), 16));
    }
    return result;
  } catch {
    return null;
  }
}

function readBigEndian32(data: number[], offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

export function parseWateringSystemStatus(payload: Buffer, serialNumber: string): WateringSystemStatus | null {
  const data = hexToIntArray(payload);
  // Response header validation: data[4] must be 66 (0x42), data[5] must be 1
  if (!data || data.length < 36 || data[4] !== 66 || data[5] !== 1) {
    return null;
  }

  const now = new Date();

  const worksEndSeconds = readBigEndian32(data, 12);
  const pumpWorksEnd = worksEndSeconds === 0
    ? null
    : new Date(now.getTime() + worksEndSeconds * 1000);

  const latestSeconds = readBigEndian32(data, 27);
  const pumpWorksLatestTime = latestSeconds === 0
    ? null
    : new Date(now.getTime() - latestSeconds * 1000);

  const nextSeconds = readBigEndian32(data, 31);
  const pumpWorksNextTime = nextSeconds === 0
    ? null
    : new Date(now.getTime() + nextSeconds * 1000);

  // ISE06 (DI-3) has pumpCycleSkipWater in bytes 35-36; ISE05 does not
  const isISE06 = serialNumber.startsWith('ISE06');
  const pumpCycleSkipWater = isISE06 && data.length > 36
    ? Math.floor((256 * data[35] + data[36]) / 60)
    : null;

  return {
    raw: data,
    pumpMode: data[9],
    errors: { lowWater: (data[7] & 1) === 1 },
    wifiState: data[6],
    pumpOn: data[8] === 1,
    pumpManualDuration: 256 * data[10] + data[11],
    pumpCycleOn: data[16] === 1,
    pumpCycleFrequency: 256 * data[17] + data[18],
    pumpCycleDuration: 256 * data[19] + data[20],
    pumpCycleMode: data[21] as CycleWateringMode,
    pumpCycleWorkingInterval: 256 * data[22] + data[23],
    pumpCycleRestInterval: 256 * data[24] + data[25],
    pumpWorksEnd,
    pumpWorksLatestReason: data[26] as WateringReason,
    pumpWorksLatestTime,
    pumpWorksNextTime,
    pumpCycleSkipWater,
  };
}

export function buildStatusRequestMessage(): number[] {
  return [65, 1];
}

export function buildUpdateMessage(status: WateringSystemStatus): number[] {
  const dur = status.pumpManualDuration || 0;
  const freq = status.pumpCycleFrequency || 0;
  const cdur = status.pumpCycleDuration || 0;
  const wint = status.pumpCycleWorkingInterval || 0;
  const rint = status.pumpCycleRestInterval || 0;

  return [
    65,
    2,
    status.pumpMode > 0 ? 1 : 0,
    status.pumpCycleOn ? 1 : 0,
    Math.floor(dur / 256), dur % 256,
    Math.floor(freq / 256), freq % 256,
    Math.floor(cdur / 256), cdur % 256,
    status.pumpCycleMode || 0,
    Math.floor(wint / 256), wint % 256,
    Math.floor(rint / 256), rint % 256,
  ];
}
