import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../entities';

export class PlaceDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class EstimateDto {
  @IsIn(VEHICLE_TYPES as unknown as string[])
  vehicle_type: VehicleType;

  @ValidateNested()
  @Type(() => PlaceDto)
  pickup: PlaceDto;

  @ValidateNested()
  @Type(() => PlaceDto)
  dropoff: PlaceDto;
}

export class CreateRideDto extends EstimateDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsString()
  @MaxLength(20)
  phone: string;

  /** Kutoka /fares/estimate; kinahakikisha nauli iliyoonyeshwa ndiyo inayotumika. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  quote_id?: string;
}

export class RatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
