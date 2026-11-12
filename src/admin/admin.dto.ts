import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../entities';

export class OwnerStatusDto {
  @IsIn(['approved', 'rejected', 'blocked', 'pending'])
  status: 'approved' | 'rejected' | 'blocked' | 'pending';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class VehicleStatusDto {
  @IsIn(['approved', 'rejected', 'suspended', 'pending'])
  status: 'approved' | 'rejected' | 'suspended' | 'pending';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class BlockDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class FareRateItemDto {
  @IsIn(VEHICLE_TYPES as unknown as string[])
  vehicle_type: VehicleType;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  base_fare: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  per_km: number;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  min_fare: number;
}

export class FareRatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => FareRateItemDto)
  rates: FareRateItemDto[];
}

export class OwnerFeeDto {
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  amount: number;

  /** Siku ya mwezi (1 hadi 28) ambayo ada inapaswa kuwa imelipwa. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  due_day?: number;
}

export class GenerateInvoicesDto {
  /** "YYYY-MM"; ukiacha, mwezi wa sasa. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period lazima iwe YYYY-MM' })
  period?: string;
}

export class MockPayDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;
}

export class GeneralSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  search_radius_km?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(300)
  request_timeout_sec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  max_trip_km?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  max_rides_per_hour?: number;
}
