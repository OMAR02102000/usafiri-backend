import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/app-error';
import { LatLng, haversineKm } from '../common/geo';
import { SettingsService } from './settings.service';

export interface DistanceResult {
  distanceKm: number;
  durationMin: number;
  /**
   * google / osrm = umbali halisi wa barabara;
   * estimate = makadirio ya mstari wa moja kwa moja
   */
  source: 'google' | 'osrm' | 'estimate';
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

    const provider = this.provider();
    try {
      if (provider === 'google') {
        const r = await this.fromGoogle(
          from,
          to,
          this.config.get<string>('GOOGLE_MAPS_API_KEY') as string,
        );
        if (r) return r;
      } else if (provider === 'osrm') {
        const r = await this.fromOsrm(from, to);
        if (r) return r;
      }
    } catch (e) {
      this.logger.warn(`Njia ya ${provider} imeshindwa, nakadiria: ${e}`);
    }
    return this.estimate(straight);
  }

  /**
   * Chanzo cha umbali. ROUTING_PROVIDER = google | osrm | estimate.
   * Ikiwa haijawekwa: google kama GOOGLE_MAPS_API_KEY ipo, vinginevyo makadirio.
   */
  private provider(): 'google' | 'osrm' | 'estimate' {
    const wanted = (this.config.get<string>('ROUTING_PROVIDER') ?? '').trim().toLowerCase();
    const hasKey = !!this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (wanted === 'osrm') return 'osrm';
    if (wanted === 'estimate') return 'estimate';
    if (wanted === 'google') return hasKey ? 'google' : 'estimate';
    return hasKey ? 'google' : 'estimate';
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

  /**
   * OSRM (OpenStreetMap): umbali halisi wa barabara, bila ufunguo. Seva ya bure
   * ya router.project-osrm.org ni ya majaribio tu (matumizi madogo); kwa
   * uzalishaji tumia seva yako mwenyewe kupitia OSRM_BASE_URL.
   */
  private async fromOsrm(from: LatLng, to: LatLng): Promise<DistanceResult | null> {
    const base = (
      this.config.get<string>('OSRM_BASE_URL') || 'https://router.project-osrm.org'
    ).replace(/\/+$/, '');
    const url =
      `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      '?overview=false&alternatives=false&steps=false';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'UsafiriBackend/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || body?.code !== 'Ok') {
      this.logger.warn(`OSRM ${res.status}: ${body?.message ?? body?.code ?? 'hitilafu'}`);
      return null;
    }
    const route = body?.routes?.[0];
    if (!route || typeof route.distance !== 'number') {
      this.logger.warn('OSRM haikurudisha njia.');
      return null;
    }
    return {
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.max(1, Math.ceil((Number(route.duration) || 0) / 60)),
      source: 'osrm',
    };
  }
}
