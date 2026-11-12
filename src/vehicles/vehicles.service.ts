import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/auth';
import { normalizeTzPhone } from '../common/phone';
import { Driver, Owner, Vehicle } from '../entities';
import {
  CreateVehicleDto,
  DriverInputDto,
  UpdateVehicleDto,
} from './vehicles.dto';

export function normalizePlate(p: string): string {
  return p.trim().toUpperCase().replace(/\s+/g, ' ');
}

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Owner) private readonly owners: Repository<Owner>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
  ) {}

  // ---------- Kutafuta vyombo vya mtumiaji ----------

  /** Vyombo ambavyo mtumiaji (mmiliki au dereva) anaruhusiwa kuvitumia. */
  async listFor(user: AuthUser): Promise<Vehicle[]> {
    const where = user.role === 'owner' ? { ownerId: user.sub } : { driverId: user.sub };
    return this.vehicles.find({ where, order: { createdAt: 'ASC' } });
  }

  async getFor(user: AuthUser, vehicleId: string): Promise<Vehicle> {
    const v = await this.vehicles.findOneBy({ id: vehicleId });
    if (!v || !this.canUse(user, v)) {
      throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Chombo hakipatikani.');
    }
    return v;
  }

  canUse(user: AuthUser, v: Vehicle): boolean {
    if (user.role === 'owner') return v.ownerId === user.sub;
    if (user.role === 'driver') return v.driverId === user.sub;
    return false;
  }

  // ---------- Mmiliki: kusajili na kubadilisha ----------

  async create(ownerId: string, dto: CreateVehicleDto) {
    const owner = await this.owners.findOneBy({ id: ownerId });
    if (!owner || owner.status === 'blocked' || owner.status === 'rejected') {
      throw new AppError(403, 'OWNER_NOT_ALLOWED', 'Akaunti haiwezi kusajili chombo.');
    }

    const plateNo = normalizePlate(dto.plate_no);
    if (await this.vehicles.existsBy({ plateNo })) {
      throw new AppError(409, 'PLATE_EXISTS', 'Namba hii ya plate imeshasajiliwa.');
    }

    const driverId = dto.driver ? await this.resolveDriver(owner, dto.driver) : null;

    const v = await this.vehicles.save(
      this.vehicles.create({
        ownerId,
        driverId,
        type: dto.type,
        plateNo,
        photoUrl: dto.photo_url ?? null,
        licenseUrl: dto.license_url ?? null,
        approvalStatus: 'pending',
        isOnline: false,
        lastLat: null,
        lastLng: null,
        lastSeenAt: null,
      }),
    );
    return v;
  }

  async update(ownerId: string, vehicleId: string, dto: UpdateVehicleDto) {
    const v = await this.vehicles.findOneBy({ id: vehicleId, ownerId });
    if (!v) throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Chombo hakipatikani.');

    if (dto.photo_url !== undefined) v.photoUrl = dto.photo_url;
    if (dto.license_url !== undefined) v.licenseUrl = dto.license_url;
    if (dto.driver) {
      const owner = await this.owners.findOneByOrFail({ id: ownerId });
      v.driverId = await this.resolveDriver(owner, dto.driver);
    }
    // Picha au leseni mpya zinahitaji kuhakikiwa tena na admin.
    if (dto.photo_url !== undefined || dto.license_url !== undefined) {
      if (v.approvalStatus === 'approved') {
        v.approvalStatus = 'pending';
        v.isOnline = false;
      }
    }
    return this.vehicles.save(v);
  }

  /**
   * Dereva wa chombo. Ikiwa namba ni ya mmiliki mwenyewe, mmiliki ndiye dereva (driverId = null).
   * Namba ya dereva haiwezi kuwa ya mmiliki mwingine au dereva wa mmiliki mwingine,
   * kwa sababu namba ndiyo inayotumika kuingia kwa OTP.
   */
  private async resolveDriver(owner: Owner, input: DriverInputDto): Promise<string | null> {
    const phone = normalizeTzPhone(input.phone);
    if (!phone) throw new AppError(400, 'INVALID_PHONE', 'Namba ya simu ya dereva si sahihi.');
    if (phone === owner.phone) return null;

    if (await this.owners.existsBy({ phone })) {
      throw new AppError(409, 'DRIVER_PHONE_TAKEN', 'Namba hii ni ya mmiliki mwingine.');
    }
    const existing = await this.drivers.findOneBy({ phone });
    if (existing) {
      if (existing.ownerId !== owner.id) {
        throw new AppError(409, 'DRIVER_PHONE_TAKEN', 'Dereva huyu yuko kwa mmiliki mwingine.');
      }
      existing.name = input.name;
      if (input.license_no) existing.licenseNo = input.license_no;
      return (await this.drivers.save(existing)).id;
    }
    const d = await this.drivers.save(
      this.drivers.create({
        ownerId: owner.id,
        name: input.name,
        phone,
        licenseNo: input.license_no ?? null,
        status: 'active',
      }),
    );
    return d.id;
  }

  // ---------- Online / Offline na GPS ----------

  async setOnline(user: AuthUser, vehicleId: string, lat?: number, lng?: number) {
    const v = await this.getFor(user, vehicleId);
    const owner = await this.owners.findOneByOrFail({ id: v.ownerId });

    if (v.approvalStatus !== 'approved' || owner.status !== 'approved') {
      throw new AppError(
        403,
        'VEHICLE_NOT_APPROVED',
        'Chombo hakijathibitishwa na admin.',
      );
    }
    if (v.driverId) {
      const d = await this.drivers.findOneBy({ id: v.driverId });
      if (!d || d.status === 'blocked') {
        throw new AppError(403, 'DRIVER_BLOCKED', 'Dereva wa chombo hiki amezuiwa.');
      }
    }

    v.isOnline = true;
    if (lat !== undefined && lng !== undefined) {
      v.lastLat = lat;
      v.lastLng = lng;
      v.lastSeenAt = new Date();
    }
    return this.vehicles.save(v);
  }

  async setOffline(user: AuthUser, vehicleId: string) {
    const v = await this.getFor(user, vehicleId);
    v.isOnline = false;
    return this.vehicles.save(v);
  }

  async updateLocation(user: AuthUser, vehicleId: string, lat: number, lng: number) {
    const v = await this.getFor(user, vehicleId);
    await this.vehicles.update(v.id, { lastLat: lat, lastLng: lng, lastSeenAt: new Date() });
    return { ok: true };
  }

  async idsFor(user: AuthUser): Promise<string[]> {
    const list = await this.listFor(user);
    return list.map((v) => v.id);
  }

  byIds(ids: string[]): Promise<Vehicle[]> {
    return ids.length ? this.vehicles.findBy({ id: In(ids) }) : Promise.resolve([]);
  }

  /** Muundo wa chombo unaorudishwa kwa app. */
  toView(v: Vehicle) {
    return {
      id: v.id,
      type: v.type,
      plate_no: v.plateNo,
      photo_url: v.photoUrl,
      license_url: v.licenseUrl,
      driver_id: v.driverId,
      approval_status: v.approvalStatus,
      is_online: v.isOnline,
      last_location:
        v.lastLat != null && v.lastLng != null
          ? { lat: v.lastLat, lng: v.lastLng, updated_at: v.lastSeenAt }
          : null,
    };
  }
}
