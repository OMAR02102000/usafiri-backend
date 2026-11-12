import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, FareRate, Setting, VehicleType } from '../entities';

/** Thamani za mwanzo; admin anaweza kuzibadilisha baadaye. */
export const DEFAULT_SETTINGS: Record<string, string> = {
  owner_monthly_fee: '5000', // ada ya kila mwezi ya mmiliki (TZS)
  owner_fee_due_day: '10', // siku ya mwezi ambayo ada inapaswa kuwa imelipwa
  search_radius_km: '3', // radius ya kutafuta chombo karibu na abiria
  request_timeout_sec: '25', // muda dereva anao kujibu ombi
  gps_stale_sec: '60', // GPS ya zamani kuliko hii haihesabiwi
  max_trip_km: '100', // umbali mrefu zaidi unaokubalika
  max_rides_per_hour: '10', // kikomo cha maombi kwa kifaa kwa saa
};

export const DEFAULT_RATES: Record<
  VehicleType,
  { baseFare: number; perKm: number; minFare: number }
> = {
  bodaboda: { baseFare: 1000, perKm: 500, minFare: 2000 },
  bajaji: { baseFare: 1500, perKm: 800, minFare: 3000 },
  taxi: { baseFare: 3000, perKm: 1200, minFare: 5000 },
};

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    @InjectRepository(FareRate) private readonly rates: Repository<FareRate>,
  ) {}

  async get(key: string): Promise<string> {
    const row = await this.settings.findOneBy({ key });
    return row?.value ?? DEFAULT_SETTINGS[key];
  }

  async getNumber(key: string): Promise<number> {
    const n = Number(await this.get(key));
    return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key]);
  }

  async set(key: string, value: string, actorId: string | null) {
    await this.settings.save({ key, value, updatedBy: actorId });
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.settings.find();
    const out = { ...DEFAULT_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  listRates(): Promise<FareRate[]> {
    return this.rates.find({ order: { vehicleType: 'ASC' } });
  }

  async getRate(type: VehicleType): Promise<FareRate> {
    const row = await this.rates.findOneBy({ vehicleType: type });
    if (row) return row;
    return Object.assign(new FareRate(), {
      vehicleType: type,
      ...DEFAULT_RATES[type],
    });
  }

  async setRate(
    type: VehicleType,
    values: { baseFare: number; perKm: number; minFare: number },
    actorId: string | null,
  ) {
    await this.rates.save({ vehicleType: type, ...values, updatedBy: actorId });
  }
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
  ) {}

  /** Kila badiliko la admin linarekodiwa pamoja na nani alilifanya na lini. */
  async log(
    actorType: string,
    actorId: string | null,
    action: string,
    targetType?: string,
    targetId?: string,
    details?: Record<string, unknown>,
  ) {
    await this.repo.save({
      actorType,
      actorId,
      action,
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      details: details ?? null,
    });
  }
}
