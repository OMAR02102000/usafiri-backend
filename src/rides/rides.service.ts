import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/auth';
import { normalizeTzPhone } from '../common/phone';
import {
  ACTIVE_RIDE_STATUSES,
  Driver,
  Owner,
  Passenger,
  Ride,
  RideRating,
  Vehicle,
} from '../entities';
import { FaresService } from '../shared/fares.service';
import { SettingsService } from '../shared/settings.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { DispatchService } from './dispatch.service';
import { CreateRideDto, EstimateDto, RatingDto } from './rides.dto';

const NEAR = 0.0005; // ~50 m: uvumilivu wa kulinganisha quote na ombi

@Injectable()
export class RidesService {
  constructor(
    private readonly fares: FaresService,
    private readonly settings: SettingsService,
    private readonly dispatch: DispatchService,
    private readonly vehicles: VehiclesService,
    @InjectRepository(Ride) private readonly rides: Repository<Ride>,
    @InjectRepository(Passenger) private readonly passengers: Repository<Passenger>,
    @InjectRepository(Vehicle) private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(Owner) private readonly owners: Repository<Owner>,
    @InjectRepository(RideRating) private readonly ratings: Repository<RideRating>,
  ) {}

  // ---------- Nauli ----------

  estimate(dto: EstimateDto) {
    this.fares.assertPlace(dto.pickup, 'Anapotoka');
    this.fares.assertPlace(dto.dropoff, 'Anapokwenda');
    return this.fares.estimate(dto.vehicle_type, dto.pickup, dto.dropoff);
  }

  // ---------- Abiria ----------

  async create(passengerId: string, dto: CreateRideDto) {
    const passenger = await this.passengers.findOneBy({ id: passengerId });
    if (!passenger) throw new AppError(401, 'UNAUTHORIZED', 'Kikao si sahihi.');
    if (passenger.status === 'blocked') {
      throw new AppError(403, 'PASSENGER_BLOCKED', 'Kifaa hiki kimezuiwa.');
    }

    const phone = normalizeTzPhone(dto.phone);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Namba ya simu si sahihi.');
    this.fares.assertPlace(dto.pickup, 'Anapotoka');
    this.fares.assertPlace(dto.dropoff, 'Anapokwenda');

    // Kinga dhidi ya maombi ya uongo: safari moja inayoendelea, na kikomo cha maombi kwa saa.
    if (await this.rides.existsBy({ passengerId, status: In(['requested', ...ACTIVE_RIDE_STATUSES]) })) {
      throw new AppError(409, 'ACTIVE_RIDE_EXISTS', 'Tayari una safari inayoendelea.');
    }
    const maxPerHour = await this.settings.getNumber('max_rides_per_hour');
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if ((await this.rides.countBy({ passengerId, requestedAt: MoreThan(hourAgo) })) >= maxPerHour) {
      throw new AppError(429, 'TOO_MANY_REQUESTS', 'Umeomba mara nyingi. Jaribu tena baadaye.');
    }

    // Nauli: tumia quote iliyosainiwa ikiwa imetumwa; la sivyo hesabu upya.
    let distanceKm: number;
    let durationMin: number;
    let fare: number;
    if (dto.quote_id) {
      const q = await this.fares.readQuote(dto.quote_id);
      if (!q) {
        throw new AppError(400, 'QUOTE_EXPIRED', 'Nauli imeisha muda. Hesabu upya.');
      }
      const same =
        q.vehicleType === dto.vehicle_type &&
        Math.abs(q.pickup.lat - dto.pickup.lat) < NEAR &&
        Math.abs(q.pickup.lng - dto.pickup.lng) < NEAR &&
        Math.abs(q.dropoff.lat - dto.dropoff.lat) < NEAR &&
        Math.abs(q.dropoff.lng - dto.dropoff.lng) < NEAR;
      if (!same) {
        throw new AppError(400, 'QUOTE_MISMATCH', 'Nauli haiendani na safari. Hesabu upya.');
      }
      ({ distanceKm, durationMin, fare } = q);
    } else {
      const e = await this.fares.estimate(dto.vehicle_type, dto.pickup, dto.dropoff);
      distanceKm = e.distance_km;
      durationMin = e.duration_min;
      fare = e.fare;
    }

    await this.passengers.update(passengerId, { name: dto.name.trim(), phone });

    const ride = await this.rides.save(
      this.rides.create({
        passengerId,
        vehicleId: null,
        vehicleType: dto.vehicle_type,
        pickupLat: dto.pickup.lat,
        pickupLng: dto.pickup.lng,
        pickupAddress: dto.pickup.address ?? null,
        dropoffLat: dto.dropoff.lat,
        dropoffLng: dto.dropoff.lng,
        dropoffAddress: dto.dropoff.address ?? null,
        distanceKm,
        durationMin,
        fare,
        status: 'requested',
        candidates: [],
        offerIndex: 0,
        offeredVehicleId: null,
        offerExpiresAt: null,
      }),
    );

    await this.dispatch.startOffering(ride);
    return this.getForPassenger(passengerId, ride.id);
  }

  async listForPassenger(passengerId: string, limit = 50, offset = 0) {
    const [rows, total] = await this.rides.findAndCount({
      where: { passengerId },
      order: { requestedAt: 'DESC' },
      take: Math.min(limit, 100),
      skip: offset,
    });
    return {
      total,
      rides: rows.map((r) => ({
        id: r.id,
        vehicle_type: r.vehicleType,
        pickup: r.pickupAddress,
        dropoff: r.dropoffAddress,
        distance_km: r.distanceKm,
        fare: r.fare,
        status: r.status,
        requested_at: r.requestedAt,
      })),
    };
  }

  async getForPassenger(passengerId: string, rideId: string) {
    const ride = await this.rides.findOneBy({ id: rideId, passengerId });
    if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');
    return this.passengerView(ride);
  }

  async cancel(passengerId: string, rideId: string) {
    const ride = await this.rides.findOneBy({ id: rideId, passengerId });
    if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');

    const res = await this.rides.update(
      { id: rideId, status: In(['requested', 'accepted']) },
      { status: 'cancelled', cancelledBy: 'passenger', offeredVehicleId: null, offerExpiresAt: null },
    );
    if (!res.affected) {
      throw new AppError(409, 'CANNOT_CANCEL', 'Safari imeshaanza au imekwisha; haiwezi kughairiwa.');
    }
    return this.getForPassenger(passengerId, rideId);
  }

  async rate(passengerId: string, rideId: string, dto: RatingDto) {
    const ride = await this.rides.findOneBy({ id: rideId, passengerId });
    if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');
    if (ride.status !== 'completed') {
      throw new AppError(409, 'RIDE_NOT_COMPLETED', 'Unaweza kutoa rating baada ya safari kukamilika.');
    }
    if (await this.ratings.existsBy({ rideId })) {
      throw new AppError(409, 'ALREADY_RATED', 'Umeshatoa rating kwa safari hii.');
    }
    await this.ratings.save({ rideId, stars: dto.stars, comment: dto.comment ?? null });
    return { ok: true };
  }

  // ---------- Dereva na mmiliki ----------

  /** Maombi yanayosubiri jibu kwa vyombo vya mtumiaji. Namba ya abiria haionekani hadi akubali. */
  async offersFor(user: AuthUser) {
    const ids = await this.vehicles.idsFor(user);
    if (ids.length === 0) return { offers: [] };

    const rows = await this.rides.find({
      where: {
        status: 'requested',
        offeredVehicleId: In(ids),
        offerExpiresAt: MoreThan(new Date()),
      },
      order: { requestedAt: 'ASC' },
    });
    return {
      offers: rows.map((r) => ({
        ride_id: r.id,
        vehicle_id: r.offeredVehicleId,
        vehicle_type: r.vehicleType,
        pickup: { lat: r.pickupLat, lng: r.pickupLng, address: r.pickupAddress },
        dropoff: { lat: r.dropoffLat, lng: r.dropoffLng, address: r.dropoffAddress },
        distance_km: r.distanceKm,
        fare: r.fare,
        expires_at: r.offerExpiresAt,
        seconds_left: Math.max(
          0,
          Math.round(((r.offerExpiresAt?.getTime() ?? 0) - Date.now()) / 1000),
        ),
      })),
    };
  }

  private async loadOffered(user: AuthUser, rideId: string): Promise<{ ride: Ride; vehicle: Vehicle }> {
    const ride = await this.rides.findOneBy({ id: rideId });
    if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');
    if (ride.status !== 'requested' || !ride.offeredVehicleId) {
      throw new AppError(409, 'RIDE_NOT_AVAILABLE', 'Ombi hili halipatikani tena.');
    }
    const vehicle = await this.vehicleRepo.findOneBy({ id: ride.offeredVehicleId });
    if (!vehicle || !this.vehicles.canUse(user, vehicle)) {
      throw new AppError(403, 'NOT_YOUR_OFFER', 'Ombi hili si lako.');
    }
    return { ride, vehicle };
  }

  async accept(user: AuthUser, rideId: string) {
    const { ride, vehicle } = await this.loadOffered(user, rideId);

    if (await this.dispatch.isBusy(vehicle.id)) {
      throw new AppError(409, 'VEHICLE_BUSY', 'Chombo hiki kina safari nyingine.');
    }

    // Sharti la hali na muda ndani ya update moja: dereva wawili hawawezi kuchukua ombi moja.
    const res = await this.rides.update(
      {
        id: ride.id,
        status: 'requested',
        offeredVehicleId: vehicle.id,
        offerExpiresAt: MoreThan(new Date()),
      },
      {
        status: 'accepted',
        vehicleId: vehicle.id,
        acceptedAt: new Date(),
        offeredVehicleId: null,
        offerExpiresAt: null,
      },
    );
    if (!res.affected) {
      throw new AppError(409, 'RIDE_NOT_AVAILABLE', 'Ombi limeisha muda au limechukuliwa.');
    }
    return this.getForDriver(user, ride.id);
  }

  async reject(user: AuthUser, rideId: string) {
    const { ride } = await this.loadOffered(user, rideId);
    await this.dispatch.advance(ride.id, ride.offerIndex);
    return { ok: true };
  }

  async arrived(user: AuthUser, rideId: string) {
    return this.transition(user, rideId, ['accepted'], { status: 'arrived', arrivedAt: new Date() });
  }

  async start(user: AuthUser, rideId: string) {
    return this.transition(user, rideId, ['accepted', 'arrived'], {
      status: 'in_progress',
      startedAt: new Date(),
    });
  }

  async complete(user: AuthUser, rideId: string) {
    return this.transition(user, rideId, ['in_progress'], {
      status: 'completed',
      completedAt: new Date(),
    });
  }

  private async transition(
    user: AuthUser,
    rideId: string,
    from: Ride['status'][],
    patch: Partial<Ride>,
  ) {
    const ride = await this.rides.findOneBy({ id: rideId });
    const vehicle = ride?.vehicleId
      ? await this.vehicleRepo.findOneBy({ id: ride.vehicleId })
      : null;
    if (!ride || !vehicle || !this.vehicles.canUse(user, vehicle)) {
      throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');
    }
    const res = await this.rides.update({ id: rideId, status: In(from) }, patch as any);
    if (!res.affected) {
      throw new AppError(409, 'INVALID_STATE', `Hatua hii haiwezekani wakati safari iko "${ride.status}".`);
    }
    return this.getForDriver(user, rideId);
  }

  /** Safari kwa dereva/mmiliki: namba ya abiria inaonekana baada ya kukubali. */
  async getForDriver(user: AuthUser, rideId: string) {
    const ride = await this.rides.findOneBy({ id: rideId });
    if (!ride) throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');

    const vehicleId = ride.vehicleId ?? ride.offeredVehicleId;
    const vehicle = vehicleId ? await this.vehicleRepo.findOneBy({ id: vehicleId }) : null;
    if (!vehicle || !this.vehicles.canUse(user, vehicle)) {
      throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');
    }

    const view: Record<string, unknown> = {
      ...this.baseView(ride),
      pickup: { lat: ride.pickupLat, lng: ride.pickupLng, address: ride.pickupAddress },
      dropoff: { lat: ride.dropoffLat, lng: ride.dropoffLng, address: ride.dropoffAddress },
    };
    if (ride.vehicleId === vehicle.id) {
      const p = await this.passengers.findOneBy({ id: ride.passengerId });
      view.passenger = { name: p?.name ?? null, phone: p?.phone ?? null };
    }
    return view;
  }

  // ---------- Muundo wa jibu ----------

  private baseView(r: Ride) {
    return {
      id: r.id,
      status: r.status,
      vehicle_type: r.vehicleType,
      distance_km: r.distanceKm,
      duration_min: r.durationMin,
      fare: r.fare,
      requested_at: r.requestedAt,
      accepted_at: r.acceptedAt,
      arrived_at: r.arrivedAt,
      started_at: r.startedAt,
      completed_at: r.completedAt,
    };
  }

  private async passengerView(r: Ride) {
    const view: Record<string, unknown> = {
      ...this.baseView(r),
      pickup: { lat: r.pickupLat, lng: r.pickupLng, address: r.pickupAddress },
      dropoff: { lat: r.dropoffLat, lng: r.dropoffLng, address: r.dropoffAddress },
    };

    // Taarifa za dereva zinaonekana kwa abiria baada ya ombi kukubaliwa.
    if (r.vehicleId && ['accepted', 'arrived', 'in_progress', 'completed'].includes(r.status)) {
      const v = await this.vehicleRepo.findOneBy({ id: r.vehicleId });
      if (v) {
        let name: string | null = null;
        let phone: string | null = null;
        if (v.driverId) {
          const d = await this.drivers.findOneBy({ id: v.driverId });
          name = d?.name ?? null;
          phone = d?.phone ?? null;
        } else {
          const o = await this.owners.findOneBy({ id: v.ownerId });
          name = o?.name ?? null;
          phone = o?.phone ?? null;
        }
        view.driver = { name, phone, plate_no: v.plateNo, vehicle_type: v.type };
        if (r.status !== 'completed' && v.lastLat != null && v.lastLng != null) {
          view.vehicle_location = { lat: v.lastLat, lng: v.lastLng, updated_at: v.lastSeenAt };
        }
      }
    }
    return view;
  }
}
