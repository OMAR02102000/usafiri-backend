import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { In, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { Invoice, Owner, Ride, Vehicle } from '../entities';

class RegisterOwnerDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  id_document?: string;
}

@Controller('owners')
export class OwnersController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Owner) private readonly owners: Repository<Owner>,
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(Ride) private readonly rides: Repository<Ride>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
  ) {}

  /** Kujisajili: inahitaji token ya "new" iliyopatikana baada ya kuthibitisha OTP. */
  @Post()
  @Roles('new')
  @HttpCode(201)
  async register(@CurrentUser() user: AuthUser, @Body() dto: RegisterOwnerDto) {
    const phone = user.phone!;
    if (await this.owners.existsBy({ phone })) {
      throw new AppError(409, 'OWNER_EXISTS', 'Namba hii imeshasajiliwa.');
    }
    const owner = await this.owners.save(
      this.owners.create({
        name: dto.name.trim(),
        phone,
        idDocument: dto.id_document ?? null,
        status: 'pending',
      }),
    );
    const signed = await this.auth.signOwner(owner);
    return { ...signed, owner: this.view(owner) };
  }

  @Get('me')
  @Roles('owner')
  async me(@CurrentUser() user: AuthUser) {
    const owner = await this.owners.findOneByOrFail({ id: user.sub });
    return this.view(owner);
  }

  @Get('me/rides')
  @Roles('owner')
  async myRides(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const mine = await this.vehicles.find({ where: { ownerId: user.sub }, select: { id: true } });
    const ids = mine.map((v) => v.id);
    if (ids.length === 0) return { rides: [], total: 0 };

    const [rows, total] = await this.rides.findAndCount({
      where: { vehicleId: In(ids) },
      order: { requestedAt: 'DESC' },
      take: Math.min(Number(limit) || 50, 100),
      skip: Number(offset) || 0,
    });
    return {
      total,
      rides: rows.map((r) => ({
        id: r.id,
        vehicle_id: r.vehicleId,
        vehicle_type: r.vehicleType,
        pickup: r.pickupAddress,
        dropoff: r.dropoffAddress,
        distance_km: r.distanceKm,
        fare: r.fare,
        status: r.status,
        requested_at: r.requestedAt,
        completed_at: r.completedAt,
      })),
    };
  }

  /** Ada ya kila mwezi na control number ya kulipia. */
  @Get('me/invoices')
  @Roles('owner')
  async myInvoices(@CurrentUser() user: AuthUser) {
    const rows = await this.invoices.find({
      where: { ownerId: user.sub },
      order: { period: 'DESC' },
    });
    return {
      invoices: rows.map((i) => ({
        id: i.id,
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

  private view(o: Owner) {
    return { id: o.id, name: o.name, phone: o.phone, status: o.status };
  }
}
