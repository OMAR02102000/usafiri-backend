import { DistanceService } from './distance.service';

const from = { lat: -6.1659, lng: 39.2026 };
const to = { lat: -6.18, lng: 39.22 };

function make(key?: string) {
  const config: any = { get: (k: string) => (k === 'GOOGLE_MAPS_API_KEY' ? key : undefined) };
  const settings: any = { getNumber: async () => 100 };
  return new DistanceService(config, settings);
}

describe('DistanceService (Google Routes API)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('bila key: makadirio', async () => {
    const r = await make().getDistance(from, to);
    expect(r.source).toBe('estimate');
  });

  it('inasoma jibu la Routes API na kutuma ombi sahihi', async () => {
    const spy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 4321, duration: '605s' }] }),
    });
    global.fetch = spy as any;
    const r = await make('KEY').getDistance(from, to);
    expect(r).toEqual({ distanceKm: 4.3, durationMin: 11, source: 'google' });

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(init.headers['X-Goog-Api-Key']).toBe('KEY');
    expect(init.headers['X-Goog-FieldMask']).toContain('routes.distanceMeters');
    const body = JSON.parse(init.body);
    expect(body.travelMode).toBe('DRIVE');
    expect(body.origin.location.latLng).toEqual({ latitude: from.lat, longitude: from.lng });
  });

  it('Google ikikataa (mfano API haijawashwa): makadirio, si kosa', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'API not enabled' } }),
    }) as any;
    const r = await make('KEY').getDistance(from, to);
    expect(r.source).toBe('estimate');
  });

  it('jibu tupu (hakuna njia): makadirio', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    const r = await make('KEY').getDistance(from, to);
    expect(r.source).toBe('estimate');
  });
});
