import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/** Aina za vyombo. Zinalingana na vehicles.type. */
export const VEHICLE_TYPES = ['bodaboda', 'bajaji', 'taxi'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type OwnerStatus = 'pending' | 'approved' | 'rejected' | 'blocked';

export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_driver';

/** Safari zinazomshikilia chombo (hakiwezi kupokea ombi lingine). */
export const ACTIVE_RIDE_STATUSES: RideStatus[] = [
  'accepted',
  'arrived',
  'in_progress',
];

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'expired';

const numeric = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v == null ? v : parseFloat(v)),
};

@Entity('passengers')
export class Passenger {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index({ unique: true })
  @Column() deviceId: string;

  @Column({ type: 'text', nullable: true }) name: string | null;

  @Index()
  @Column({ type: 'text', nullable: true })
  phone: string | null;

  @Column({ default: 'active' }) status: 'active' | 'blocked';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('owners')
export class Owner {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;

  @Index({ unique: true })
  @Column() phone: string;

  @Column({ type: 'text', nullable: true }) idDocument: string | null;
  @Column({ default: 'pending' }) status: OwnerStatus;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column('uuid') ownerId: string;

  @Column() name: string;

  @Index({ unique: true })
  @Column() phone: string;

  @Column({ type: 'text', nullable: true }) licenseNo: string | null;
  @Column({ default: 'active' }) status: 'active' | 'blocked';
}

@Entity('vehicles')
@Index(['type', 'isOnline'])
export class Vehicle {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column('uuid') ownerId: string;

  @Column({ type: 'uuid', nullable: true }) driverId: string | null;
  @Column() type: VehicleType;

  @Index({ unique: true })
  @Column() plateNo: string;

  @Column({ type: 'text', nullable: true }) photoUrl: string | null;
  @Column({ type: 'text', nullable: true }) licenseUrl: string | null;
  @Column({ default: 'pending' }) approvalStatus: ApprovalStatus;
  @Column({ default: false }) isOnline: boolean;
  @Column({ type: 'double precision', nullable: true }) lastLat: number | null;
  @Column({ type: 'double precision', nullable: true }) lastLng: number | null;
  @Column({ type: 'timestamptz', nullable: true }) lastSeenAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('rides')
@Index(['status', 'requestedAt'])
@Index(['passengerId', 'requestedAt'])
export class Ride {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column('uuid') passengerId: string;
  @Column({ type: 'uuid', nullable: true }) vehicleId: string | null;
  @Column() vehicleType: VehicleType;

  @Column({ type: 'double precision' }) pickupLat: number;
  @Column({ type: 'double precision' }) pickupLng: number;
  @Column({ type: 'text', nullable: true }) pickupAddress: string | null;
  @Column({ type: 'double precision' }) dropoffLat: number;
  @Column({ type: 'double precision' }) dropoffLng: number;
  @Column({ type: 'text', nullable: true }) dropoffAddress: string | null;

  @Column({ type: 'numeric', precision: 6, scale: 1, transformer: numeric })
  distanceKm: number;
  @Column({ type: 'int', default: 0 }) durationMin: number;

  /** Nauli kwa TZS, imehifadhiwa wakati wa kuomba. */
  @Column({ type: 'int' }) fare: number;
  @Column({ default: 'requested' }) status: RideStatus;

  /** Vyombo vilivyochaguliwa kupewa ombi, vimepangwa kuanzia kilicho karibu zaidi. */
  @Column({ type: 'jsonb', default: () => "'[]'" }) candidates: string[];
  @Column({ type: 'int', default: 0 }) offerIndex: number;
  @Column({ type: 'uuid', nullable: true }) offeredVehicleId: string | null;
  @Column({ type: 'timestamptz', nullable: true }) offerExpiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' }) requestedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) arrivedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date | null;
  @Column({ type: 'text', nullable: true }) cancelledBy: string | null;
}

@Entity('ride_ratings')
export class RideRating {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index({ unique: true })
  @Column('uuid') rideId: string;

  @Column({ type: 'smallint' }) stars: number;
  @Column({ type: 'text', nullable: true }) comment: string | null;
}

@Entity('fare_rates')
export class FareRate {
  @PrimaryColumn() vehicleType: VehicleType;
  @Column({ type: 'int' }) baseFare: number;
  @Column({ type: 'int' }) perKm: number;
  @Column({ type: 'int' }) minFare: number;
  @Column({ type: 'text', nullable: true }) updatedBy: string | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('settings')
export class Setting {
  @PrimaryColumn() key: string;
  @Column({ type: 'text' }) value: string;
  @Column({ type: 'text', nullable: true }) updatedBy: string | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}

@Entity('invoices')
@Unique(['ownerId', 'period'])
@Index(['status', 'dueDate'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column('uuid') ownerId: string;

  /** Mwezi, mfano 2026-11 */
  @Column() period: string;
  @Column({ type: 'int' }) amount: number;
  @Column({ type: 'int', default: 0 }) paidAmount: number;

  @Index()
  @Column({ type: 'text', nullable: true })
  controlNumber: string | null;

  @Column({ default: 'unpaid' }) status: InvoiceStatus;
  @Column({ type: 'date' }) dueDate: string;
  @Column({ type: 'timestamptz', nullable: true }) paidAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column('uuid') invoiceId: string;

  @Index({ unique: true })
  @Column() providerRef: string;

  @Column({ type: 'int' }) amount: number;
  @Column({ type: 'timestamptz' }) paidAt: Date;
  @Column({ type: 'jsonb', nullable: true }) rawPayload: Record<string, unknown> | null;
}

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;

  @Index({ unique: true })
  @Column() email: string;

  @Column() passwordHash: string;
  @Column({ default: 'super_admin' }) role: 'super_admin' | 'support' | 'finance';
}

@Entity('otp_codes')
export class OtpCode {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column() phone: string;

  @Column() codeHash: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ default: false }) used: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() actorType: string;
  @Column({ type: 'text', nullable: true }) actorId: string | null;
  @Column() action: string;
  @Column({ type: 'text', nullable: true }) targetType: string | null;
  @Column({ type: 'text', nullable: true }) targetId: string | null;
  @Column({ type: 'jsonb', nullable: true }) details: Record<string, unknown> | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

export const ALL_ENTITIES = [
  Passenger,
  Owner,
  Driver,
  Vehicle,
  Ride,
  RideRating,
  FareRate,
  Setting,
  Invoice,
  Payment,
  Admin,
  OtpCode,
  AuditLog,
];
