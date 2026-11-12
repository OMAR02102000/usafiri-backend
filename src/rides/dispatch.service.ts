import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { LatLng, haversineKm } from '../common/geo';
import { ACTIVE_RIDE_STATUSES, Owner, Ride, Vehicle, VehicleType } from '../entities';
import { SettingsService } from '../shared/settings.service';

/**
 * Kuunganisha abiria na chombo kilicho karibu.
 *
 * 1. Tunachagua vyombo vya aina aliyoomba abiria ambavyo ni online, vimethibitishwa,
 *    havina safari nyingine, vina GPS mpya, na viko ndani ya radius.
 * 2. Tunavipanga kuanzia kilicho karibu zaidi.
 * 3. Ombi linatolewa kwa kimoja kwa wakati; kikikataa au kikichelewa kujibu,
 *    linaenda kwa kinachofuata. Vikiisha, safari inakuwa "no_driver".
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly settings: SettingsService,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Ride) private readonly rides: Repository<Ride>,
  ) {}

  private async busyVehicleIds(): Promise<Set<string>> {
    const active = await this.rides.find({
      where: { status: In(ACTIVE_RIDE_STATUSES) },
      select: { vehicleId: true },
    });
    return new Set(active.map((r) => r.vehicleId).filter((id): id is string => !!id));
  }

  async isBusy(vehicleId: string): Promise<boolean> {
    return this.rides.existsBy({ vehicleId, status: In(ACTIVE_RIDE_STATUSES) });
  }

  async findCandidates(type: VehicleType, pickup: LatLng): Promise<string[]> {
    const radiusKm = await this.settings.getNumber('search_radius_km');
    const staleSec = await this.settings.getNumber('gps_stale_sec');
    const since = new Date(Date.now() - staleSec * 1000);

    const online = await this.vehicles
      .createQueryBuilder('v')
      .innerJoin(Owner, 'o', 'o.id = v.ownerId')
      .where('v.type = :type', { type })
      .andWhere('v.isOnline = true')
      .andWhere('v.approvalStatus = :appr', { appr: 'approved' })
      .andWhere('o.status = :ostatus', { ostatus: 'approved' })
      .andWhere('v.lastLat IS NOT NULL')
      .andWhere('v.lastLng IS NOT NULL')
      .andWhere('v.lastSeenAt >= :since', { since })
      .getMany();

    const busy = await this.busyVehicleIds();

    return online
      .filter((v) => !busy.has(v.id))
      .map((v) => ({
        id: v.id,
        km: haversineKm(pickup, { lat: v.lastLat!, lng: v.lastLng! }),
      }))
      .filter((c) => c.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .map((c) => c.id);
  }

  /** Inaanza kutoa ombi kwa chombo cha kwanza kilicho karibu. */
  async startOffering(ride: Ride): Promise<void> {
    const candidates = await this.findCandidates(ride.vehicleType, {
      lat: ride.pickupLat,
      lng: ride.pickupLng,
    });

    if (candidates.length === 0) {
      await this.rides.update(ride.id, { status: 'no_driver', candidates: [] });
      return;
    }

    const timeout = await this.settings.getNumber('request_timeout_sec');
    await this.rides.update(ride.id, {
      candidates,
      offerIndex: 0,
      offeredVehicleId: candidates[0],
      offerExpiresAt: new Date(Date.now() + timeout * 1000),
    });
  }

  private async isOfferable(vehicleId: string): Promise<boolean> {
    const v = await this.vehicles.findOneBy({ id: vehicleId });
    if (!v || !v.isOnline || v.approvalStatus !== 'approved') return false;
    return !(await this.isBusy(vehicleId));
  }

  /** Inapeleka ombi kwa chombo kinachofuata (baada ya kukataa au muda kuisha). */
  async advance(rideId: string, currentIndex: number): Promise<void> {
    const ride = await this.rides.findOneBy({ id: rideId });
    if (!ride || ride.status !== 'requested' || ride.offerIndex !== currentIndex) return;

    const timeout = await this.settings.getNumber('request_timeout_sec');
    for (let idx = currentIndex + 1; idx < ride.candidates.length; idx++) {
      const vehicleId = ride.candidates[idx];
      if (await this.isOfferable(vehicleId)) {
        await this.rides.update(
          { id: rideId, status: 'requested', offerIndex: currentIndex },
          {
            offerIndex: idx,
            offeredVehicleId: vehicleId,
            offerExpiresAt: new Date(Date.now() + timeout * 1000),
          },
        );
        return;
      }
    }

    await this.rides.update(
      { id: rideId, status: 'requested', offerIndex: currentIndex },
      { status: 'no_driver', offeredVehicleId: null, offerExpiresAt: null },
    );
  }

  /** Kila baada ya sekunde 5: maombi ambayo dereva hakujibu kwa wakati yanaenda kwa anayefuata. */
  @Interval(5000)
  async expireOffers(): Promise<void> {
    try {
      const stale = await this.rides.find({
        where: { status: 'requested', offerExpiresAt: LessThan(new Date()) },
        take: 50,
      });
      for (const r of stale) {
        await this.advance(r.id, r.offerIndex);
      }
    } catch (e) {
      this.logger.error(`expireOffers imeshindwa: ${e}`);
    }
  }
}
