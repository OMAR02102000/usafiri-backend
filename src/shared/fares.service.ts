import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppError } from '../common/app-error';
import { VehicleType } from '../entities';
import { DistanceResult, DistanceService } from './distance.service';
import { LatLng } from '../common/geo';
import { SettingsService } from './settings.service';

export interface PlaceInput extends LatLng {
  address?: string;
}

export interface QuotePayload {
  typ: 'quote';
  vehicleType: VehicleType;
  pickup: PlaceInput;
  dropoff: PlaceInput;
  distanceKm: number;
  durationMin: number;
  fare: number;
}

/** Fomula: nauli = baseFare + (km x perKm), isiwe chini ya minFare. Inahesabiwa na server pekee. */
export function computeFare(
  rate: { baseFare: number; perKm: number; minFare: number },
  distanceKm: number,
): number {
  const km = Math.max(0, distanceKm);
  const fare = Math.round(rate.baseFare + km * rate.perKm);
  return Math.max(fare, rate.minFare);
}

@Injectable()
export class FaresService {
  constructor(
    private readonly settings: SettingsService,
    private readonly distance: DistanceService,
    private readonly jwt: JwtService,
  ) {}

  async estimate(type: VehicleType, pickup: PlaceInput, dropoff: PlaceInput) {
    const d: DistanceResult = await this.distance.getDistance(pickup, dropoff);
    const rate = await this.settings.getRate(type);
    const fare = computeFare(rate, d.distanceKm);

    const payload: QuotePayload = {
      typ: 'quote',
      vehicleType: type,
      pickup,
      dropoff,
      distanceKm: d.distanceKm,
      durationMin: d.durationMin,
      fare,
    };
    // quote_id ni kitu kilichosainiwa; kinathibitisha kuwa nauli iliyoonyeshwa ndiyo itakayotumika.
    const quoteId = await this.jwt.signAsync(payload, { expiresIn: '10m' });

    return {
      distance_km: d.distanceKm,
      duration_min: d.durationMin,
      fare,
      currency: 'TZS',
      distance_source: d.source,
      quote_id: quoteId,
    };
  }

  /** Inathibitisha quote_id; inarudisha payload yake au null kama si sahihi/imeisha muda. */
  async readQuote(quoteId: string): Promise<QuotePayload | null> {
    try {
      const p = await this.jwt.verifyAsync<QuotePayload>(quoteId);
      return p.typ === 'quote' ? p : null;
    } catch {
      return null;
    }
  }

  assertPlace(p: PlaceInput | undefined, label: string) {
    if (
      !p ||
      typeof p.lat !== 'number' ||
      typeof p.lng !== 'number' ||
      p.lat < -90 ||
      p.lat > 90 ||
      p.lng < -180 ||
      p.lng > 180
    ) {
      throw new AppError(400, 'INVALID_LOCATION', `${label} si sahihi.`);
    }
  }
}
