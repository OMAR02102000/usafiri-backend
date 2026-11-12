import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/app-error';
import { LatLng, haversineKm } from '../common/geo';
import { SettingsService } from './settings.service';

export interface DistanceResult {
  distanceKm: number;
  durationMin: number;
  /** google = umbali halisi wa barabara; estimate = makadirio ya mstari wa moja kwa moja */
  source: 'google' | 'estimate';
}

@Injectable()
export class DistanceService {
  private readonly logger = new Logger(DistanceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  async getDistance(from: LatLng, to: LatLng): Promise<DistanceResult> {
    const maxKm = await this.settings.getNumber('max_trip_km');
    const straight = haversineKm(from, to);
    if (straight > maxKm) {
      throw new AppError(
        400,
        'DISTANCE_TOO_LONG',
        `Umbali ni mrefu kuliko km ${maxKm} zinazoruhusiwa.`,
      );
    }

    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (key) {
      try {
        const r = await this.fromGoogle(from, to, key);
        if (r) return r;
      } catch (e) {
        this.logger.warn(`Google Routes imeshindwa, nakadiria: ${e}`);
      }
    }
    return this.estimate(straight);
  }

  /** Bila Google: barabara kwa kawaida ni ndefu ~35% kuliko mstari wa moja kwa moja. */
  private estimate(straightKm: number): DistanceResult {
    const km = Math.round(straightKm * 1.35 * 10) / 10;
    return {
      distanceKm: km,
      durationMin: Math.max(1, Math.ceil((km / 25) * 60)),
      source: 'estimate',
    };
  }

  /** Google Routes API (mbadala wa Directions API ya zamani, isiyopatikana kwenye project mpya). */
  private async fromGoogle(
    from: LatLng,
    to: LatLng,
    key: string,
  ): Promise<DistanceResult | null> {
    const point = (p: LatLng) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    });
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: point(from),
        destination: point(to),
        travelMode: 'DRIVE',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      this.logger.warn(`Google Routes ${res.status}: ${body?.error?.message ?? 'hitilafu'}`);
      return null;
    }
    const route = body?.routes?.[0];
    if (!route || typeof route.distanceMeters !== 'number') {
      this.logger.warn('Google Routes haikurudisha njia.');
      return null;
    }
    const seconds = Number.parseFloat(String(route.duration ?? '0').replace('s', '')) || 0;
    return {
      distanceKm: Math.round((route.distanceMeters / 1000) * 10) / 10,
      durationMin: Math.max(1, Math.ceil(seconds / 60)),
      source: 'google',
    };
  }
}
