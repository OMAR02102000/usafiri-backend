import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../entities';

export class DriverInputDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  license_no?: string;
}

export class CreateVehicleDto {
  @IsIn(VEHICLE_TYPES as unknown as string[])
  type: VehicleType;

  @IsString()
  @Length(3, 20)
  plate_no: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  photo_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  license_url?: string;

  /** Ukiacha wazi, mmiliki mwenyewe ndiye dereva. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DriverInputDto)
  driver?: DriverInputDto;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photo_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  license_url?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DriverInputDto)
  driver?: DriverInputDto;
}

export class LocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class OnlineDto {
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}
