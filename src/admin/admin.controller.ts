import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, ILike, In, Repository } from 'typeorm';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import {
  Driver,
  Invoice,
  Owner,
  Passenger,
  Ride,
  RideStatus,
  Vehicle,
} from '../entities';
import { PaymentsService, currentPeriod, isValidPeriod } from '../payments/payments.service';
import { AuditService, SettingsService } from '../shared/settings.service';
import {
  BlockDto,
  FareRatesDto,
  GeneralSettingsDto,
  GenerateInvoicesDto,
  MockPayDto,
  OwnerFeeDto,
  OwnerStatusDto,
  VehicleStatusDto,
} from './admin.dto';

/** super_admin anafanya yote; support anasimamia watumiaji; finance anasimamia bei na malipo. */
type AdminRole = 'super_admin' | 'support' | 'finance';
const USERS: AdminRole[] = ['super_admin', 'support'];
const MONEY: AdminRole[] = ['super_admin', 'finance'];

function need(user: AuthUser, allowed: AdminRole[]) {
  if (!allowed.includes(user.adminRole as AdminRole)) {
    throw new AppError(403, 'FORBIDDEN', 'Cheo chako hakiruhusu kufanya hili.');
  }
}

function page(limit?: string, offset?: string) {
  return { take: Math.min(Math.max(Number(limit) || 50, 1), 200), skip: Math.max(Number(offset) || 0, 0) };
}

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    @InjectRepository(Ride) private readonly rides: Repository<Ride>,
    @InjectRepository(Owner) private readonly owners: Repository<Owner>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Passenger) private readonly passengers: Repository<Passenger>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
  ) {}

  // ---------- Order (safari) ----------

  @Get('rides')
  async listRides(
    @Query('status') status?: string,
    @Query('vehicle_id') vehicleId?: string,
    @Query('owner_id') ownerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const qb = this.rides
      .createQueryBuilder('r')
      .leftJoinAndMapOne('r.vehicle', Vehicle, 'v', 'v.id = r.vehicleId')
      .leftJoinAndMapOne('r.passenger', Passenger, 'p', 'p.id = r.passengerId')
      .orderBy('r.requestedAt', 'DESC');

    if (status) qb.andWhere('r.status = :status', { status });
    if (vehicleId) qb.andWhere('r.vehicleId = :vehicleId', { vehicleId });
    if (ownerId) qb.andWhere('v.ownerId = :ownerId', { ownerId });
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_DATE', 'from si sahihi.');
      qb.andWhere('r.requestedAt >= :from', { from: d });
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_DATE', 'to si sahihi.');
      qb.andWhere('r.requestedAt <= :to', { to: d });
    }
    const { take, skip } = page(limit, offset);
    qb.take(take).skip(skip);

    const [rows, total] = await qb.getManyAndCount();
    return { total, rides: rows.map((r: any) => this.rideRow(r)) };
  }

  @Get('rides/:id')
  async getRide(@Param('id', ParseUUIDPipe) id: string) {
    const r: any = await this.rides.findOneBy({ id });
    if (!r) throw new AppError(404, 'RIDE_NOT_FOUND', 'Safari haipatikani.');
    r.vehicle = r.vehicleId ? await this.vehicles.findOneBy({ id: r.vehicleId }) : null;
    r.passenger = await this.passengers.findOneBy({ id: r.passengerId });
    const owner = r.vehicle ? await this.owners.findOneBy({ id: r.vehicle.ownerId }) : null;
    const driver = r.vehicle?.driverId ? await this.drivers.findOneBy({ id: r.vehicle.driverId }) : null;
    return {
      ...this.rideRow(r),
      pickup: { lat: r.pickupLat, lng: r.pickupLng, address: r.pickupAddress },
      dropoff: { lat: r.dropoffLat, lng: r.dropoffLng, address: r.dropoffAddress },
      duration_min: r.durationMin,
      accepted_at: r.acceptedAt,
      arrived_at: r.arrivedAt,
      started_at: r.startedAt,
      completed_at: r.completedAt,
      cancelled_by: r.cancelledBy,
      owner: owner ? { id: owner.id, name: owner.name, phone: owner.phone } : null,
      driver: driver ? { id: driver.id, name: driver.name, phone: driver.phone } : null,
    };
  }

  private rideRow(r: any) {
    return {
      id: r.id,
      status: r.status,
      vehicle_type: r.vehicleType,
      pickup: r.pickupAddress,
      dropoff: r.dropoffAddress,
      distance_km: r.distanceKm,
      fare: r.fare,
      requested_at: r.requestedAt,
      passenger: r.passenger
        ? { id: r.passenger.id, name: r.passenger.name, phone: r.passenger.phone }
        : null,
      vehicle: r.vehicle
        ? { id: r.vehicle.id, plate_no: r.vehicle.plateNo, type: r.vehicle.type, owner_id: r.vehicle.ownerId }
        : null,
    };
  }

  // ---------- Wamiliki ----------

  @Get('owners')
  async listOwners(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: FindOptionsWhere<Owner>[] = [];
    const base: FindOptionsWhere<Owner> = status ? { status: status as Owner['status'] } : {};
    if (q) {
      where.push({ ...base, name: ILike(`%${q}%`) }, { ...base, phone: ILike(`%${q}%`) });
    } else {
      where.push(base);
    }
    const [rows, total] = await this.owners.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...page(limit, offset),
    });
    return {
      total,
      owners: rows.map((o) => ({
        id: o.id,
        name: o.name,
        phone: o.phone,
        id_document: o.idDocument,
        status: o.status,
        created_at: o.createdAt,
      })),
    };
  }

  @Patch('owners/:id/status')
  async setOwnerStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OwnerStatusDto,
  ) {
    need(admin, USERS);
    const owner = await this.owners.findOneBy({ id });
    if (!owner) throw new AppError(404, 'OWNER_NOT_FOUND', 'Mmiliki hapatikani.');

    const before = owner.status;
    owner.status = dto.status;
    await this.owners.save(owner);

    // Mmiliki asiyeruhusiwa tena: vyombo vyake vinatoka online mara moja.
    if (dto.status !== 'approved') {
      await this.vehicles.update({ ownerId: id }, { isOnline: false });
    }
    // Akithibitishwa, anapata ankara ya mwezi huu mara moja.
    if (dto.status === 'approved' && before !== 'approved') {
      await this.payments.ensureInvoice(owner, currentPeriod());
    }
    await this.audit.log('admin', admin.sub, 'owner.status', 'owner', id, {
      from: before,
      to: dto.status,
      reason: dto.reason ?? null,
    });
    return { id, status: owner.status };
  }

  // ---------- Vyombo ----------

  @Get('vehicles')
  async listVehicles(
    @Query('approval_status') approval?: string,
    @Query('owner_id') ownerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: FindOptionsWhere<Vehicle> = {};
    if (approval) where.approvalStatus = approval as Vehicle['approvalStatus'];
    if (ownerId) where.ownerId = ownerId;
    const [rows, total] = await this.vehicles.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...page(limit, offset),
    });
    return {
      total,
      vehicles: rows.map((v) => ({
        id: v.id,
        owner_id: v.ownerId,
        driver_id: v.driverId,
        type: v.type,
        plate_no: v.plateNo,
        photo_url: v.photoUrl,
        license_url: v.licenseUrl,
        approval_status: v.approvalStatus,
        is_online: v.isOnline,
      })),
    };
  }

  @Patch('vehicles/:id/status')
  async setVehicleStatus(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VehicleStatusDto,
  ) {
    need(admin, USERS);
    const v = await this.vehicles.findOneBy({ id });
    if (!v) throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Chombo hakipatikani.');

    const before = v.approvalStatus;
    v.approvalStatus = dto.status;
    if (dto.status !== 'approved') v.isOnline = false;
    await this.vehicles.save(v);
    await this.audit.log('admin', admin.sub, 'vehicle.status', 'vehicle', id, {
      from: before,
      to: dto.status,
      reason: dto.reason ?? null,
    });
    return { id, approval_status: v.approvalStatus };
  }

  // ---------- Abiria ----------

  @Get('passengers')
  async listPassengers(
    @Query('phone') phone?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: FindOptionsWhere<Passenger> = {};
    if (phone) where.phone = ILike(`%${phone}%`) as any;
    if (status) where.status = status as Passenger['status'];
    const [rows, total] = await this.passengers.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...page(limit, offset),
    });
    return {
      total,
      passengers: rows.map((p) => ({
        id: p.id,
        name: p.name,
        phone: p.phone,
        status: p.status,
        created_at: p.createdAt,
      })),
    };
  }

  @Post('passengers/:id/block')
  @HttpCode(200)
  async blockPassenger(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockDto,
  ) {
    return this.setPassengerStatus(admin, id, 'blocked', dto.reason);
  }

  @Post('passengers/:id/unblock')
  @HttpCode(200)
  async unblockPassenger(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockDto,
  ) {
    return this.setPassengerStatus(admin, id, 'active', dto.reason);
  }

  private async setPassengerStatus(
    admin: AuthUser,
    id: string,
    status: 'active' | 'blocked',
    reason?: string,
  ) {
    need(admin, USERS);
    const p = await this.passengers.findOneBy({ id });
    if (!p) throw new AppError(404, 'PASSENGER_NOT_FOUND', 'Abiria hapatikani.');
    await this.passengers.update(id, { status });
    // Mtu aliyezuiwa hawezi kuendelea na ombi lililo wazi.
    if (status === 'blocked') {
      await this.rides.update(
        { passengerId: id, status: 'requested' },
        { status: 'cancelled', cancelledBy: 'admin', offeredVehicleId: null, offerExpiresAt: null },
      );
    }
    await this.audit.log('admin', admin.sub, `passenger.${status}`, 'passenger', id, {
      reason: reason ?? null,
    });
    return { id, status };
  }

  // ---------- Ankara na malipo ya ada ----------

  @Get('invoices')
  async listInvoices(
    @Query('period') period?: string,
    @Query('status') status?: string,
    @Query('owner_id') ownerId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: FindOptionsWhere<Invoice> = {};
    if (period) where.period = period;
    if (status) where.status = status as Invoice['status'];
    if (ownerId) where.ownerId = ownerId;

    const [rows, total] = await this.invoices.findAndCount({
      where,
      order: { period: 'DESC', createdAt: 'DESC' },
      ...page(limit, offset),
    });
    const owners = rows.length
      ? await this.owners.findBy({ id: In([...new Set(rows.map((r) => r.ownerId))]) })
      : [];
    const byId = new Map(owners.map((o) => [o.id, o]));

    return {
      total,
      invoices: rows.map((i) => ({
        id: i.id,
        owner: byId.get(i.ownerId)
          ? { id: i.ownerId, name: byId.get(i.ownerId)!.name, phone: byId.get(i.ownerId)!.phone }
          : { id: i.ownerId },
        period: i.period,
        amount: i.amount,
        paid_amount: i.paidAmount,
        control_number: i.controlNumber,
        status: i.status,
        due_date: i.dueDate,
        paid_at: i.paidAt,
      })),
    };
  }

  @Post('invoices/generate')
  @HttpCode(200)
  async generateInvoices(@CurrentUser() admin: AuthUser, @Body() dto: GenerateInvoicesDto) {
    need(admin, MONEY);
    const period = dto.period ?? currentPeriod();
    if (!isValidPeriod(period)) throw new AppError(400, 'INVALID_PERIOD', 'period lazima iwe YYYY-MM.');
    const r = await this.payments.generateForPeriod(period);
    await this.audit.log('admin', admin.sub, 'invoices.generate', 'invoice', period, { ...r });
    return r;
  }

  /** Majaribio tu: kuiga malipo ya ankara wakati mtoa huduma halisi hajaunganishwa. */
  @Post('invoices/:id/mock-pay')
  @HttpCode(200)
  async mockPay(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MockPayDto,
  ) {
    need(admin, MONEY);
    const r = await this.payments.mockPay(id, dto.amount);
    await this.audit.log('admin', admin.sub, 'invoice.mock_pay', 'invoice', id, { amount: dto.amount ?? null });
    return r;
  }

  // ---------- Bei na ada ----------

  @Get('settings')
  async getSettings() {
    const rates = await this.settings.listRates();
    const all = await this.settings.all();
    return {
      fare_rates: rates.map((r) => ({
        vehicle_type: r.vehicleType,
        base_fare: r.baseFare,
        per_km: r.perKm,
        min_fare: r.minFare,
      })),
      owner_fee: {
        amount: Number(all.owner_monthly_fee),
        due_day: Number(all.owner_fee_due_day),
      },
      general: {
        search_radius_km: Number(all.search_radius_km),
        request_timeout_sec: Number(all.request_timeout_sec),
        max_trip_km: Number(all.max_trip_km),
        max_rides_per_hour: Number(all.max_rides_per_hour),
      },
    };
  }

  @Put('settings/fare-rates')
  async setFareRates(@CurrentUser() admin: AuthUser, @Body() dto: FareRatesDto) {
    need(admin, MONEY);
    const seen = new Set<string>();
    for (const r of dto.rates) {
      if (seen.has(r.vehicle_type)) {
        throw new AppError(400, 'DUPLICATE_TYPE', `${r.vehicle_type} imerudiwa.`);
      }
      seen.add(r.vehicle_type);
    }
    for (const r of dto.rates) {
      const before = await this.settings.getRate(r.vehicle_type);
      await this.settings.setRate(
        r.vehicle_type,
        { baseFare: r.base_fare, perKm: r.per_km, minFare: r.min_fare },
        admin.sub,
      );
      await this.audit.log('admin', admin.sub, 'settings.fare_rate', 'fare_rate', r.vehicle_type, {
        from: { base_fare: before.baseFare, per_km: before.perKm, min_fare: before.minFare },
        to: { base_fare: r.base_fare, per_km: r.per_km, min_fare: r.min_fare },
      });
    }
    return this.getSettings();
  }

  /** Mabadiliko yanahusu ankara mpya tu; ankara zilizokwisha tengenezwa hazibadiliki. */
  @Put('settings/owner-fee')
  async setOwnerFee(@CurrentUser() admin: AuthUser, @Body() dto: OwnerFeeDto) {
    need(admin, MONEY);
    const before = await this.settings.all();
    await this.settings.set('owner_monthly_fee', String(dto.amount), admin.sub);
    if (dto.due_day !== undefined) {
      await this.settings.set('owner_fee_due_day', String(dto.due_day), admin.sub);
    }
    await this.audit.log('admin', admin.sub, 'settings.owner_fee', 'setting', 'owner_monthly_fee', {
      from: { amount: Number(before.owner_monthly_fee), due_day: Number(before.owner_fee_due_day) },
      to: { amount: dto.amount, due_day: dto.due_day ?? Number(before.owner_fee_due_day) },
    });
    return this.getSettings();
  }

  @Put('settings/general')
  async setGeneral(@CurrentUser() admin: AuthUser, @Body() dto: GeneralSettingsDto) {
    need(admin, ['super_admin']);
    const changed: Record<string, number> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      await this.settings.set(key, String(value), admin.sub);
      changed[key] = value as number;
    }
    await this.audit.log('admin', admin.sub, 'settings.general', 'setting', undefined, changed);
    return this.getSettings();
  }

  // ---------- Ripoti ----------

  @Get('reports/summary')
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const end = to ? new Date(to) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError(400, 'INVALID_DATE', 'Tarehe si sahihi.');
    }

    const byStatus = await this.rides
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('r.requestedAt BETWEEN :start AND :end', { start, end })
      .groupBy('r.status')
      .getRawMany<{ status: RideStatus; count: number }>();

    const done = await this.rides
      .createQueryBuilder('r')
      .select('COUNT(*)::int', 'count')
      .addSelect('COALESCE(SUM(r.fare), 0)::int', 'fare_total')
      .addSelect('COALESCE(SUM(r.distanceKm), 0)::float', 'km_total')
      .where('r.status = :s', { s: 'completed' })
      .andWhere('r.completedAt BETWEEN :start AND :end', { start, end })
      .getRawOne<{ count: number; fare_total: number; km_total: number }>();

    const topVehicles = await this.rides
      .createQueryBuilder('r')
      .innerJoin(Vehicle, 'v', 'v.id = r.vehicleId')
      .select('v.id', 'vehicle_id')
      .addSelect('v.plateNo', 'plate_no')
      .addSelect('COUNT(*)::int', 'rides')
      .where('r.status = :s', { s: 'completed' })
      .andWhere('r.completedAt BETWEEN :start AND :end', { start, end })
      .groupBy('v.id')
      .addGroupBy('v.plateNo')
      .orderBy('rides', 'DESC')
      .limit(5)
      .getRawMany();

    const period = currentPeriod();
    const fees = await this.invoices
      .createQueryBuilder('i')
      .select('i.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .addSelect('COALESCE(SUM(i.amount), 0)::int', 'amount')
      .addSelect('COALESCE(SUM(i.paidAmount), 0)::int', 'paid_amount')
      .where('i.period = :period', { period })
      .groupBy('i.status')
      .getRawMany();

    const ownersByStatus = await this.owners
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('o.status')
      .getRawMany();

    const onlineVehicles = await this.vehicles.countBy({ isOnline: true });
    const pendingVehicles = await this.vehicles.countBy({ approvalStatus: 'pending' });

    return {
      range: { from: start, to: end },
      rides_by_status: byStatus,
      completed: {
        count: done?.count ?? 0,
        // Nauli inalipwa cash kwa dereva; hii si mapato ya mfumo.
        fare_total_cash: done?.fare_total ?? 0,
        km_total: done?.km_total ?? 0,
      },
      top_vehicles: topVehicles,
      vehicles: { online: onlineVehicles, pending_approval: pendingVehicles },
      owners_by_status: ownersByStatus,
      owner_fees: { period, by_status: fees },
    };
  }
}
