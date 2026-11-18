import { DistanceService } from './distance.service';

const from = { lat: -6.1659, lng: 39.2026 };
const to = { lat: -6.18, lng: 39.22 };

function make(key?: string, extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { GOOGLE_MAPS_API_KEY: key, ...extra };
  const config: any = { get: (k: string) => env[k] };
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

describe('DistanceService (OSRM / OpenStreetMap)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('ROUTING_PROVIDER=osrm: inasoma umbali na kutuma ombi sahihi (lng,lat)', async () => {
    const spy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 'Ok', routes: [{ distance: 4321.4, duration: 605 }] }),
    });
    global.fetch = spy as any;
    const r = await make(undefined, { ROUTING_PROVIDER: 'osrm' }).getDistance(from, to);
    expect(r).toEqual({ distanceKm: 4.3, durationMin: 11, source: 'osrm' });

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(
      'https://router.project-osrm.org/route/v1/driving/39.2026,-6.1659;39.22,-6.18' +
        '?overview=false&alternatives=false&steps=false',
    );
    expect(init.headers['User-Agent']).toBeTruthy();
  });

  it('OSRM_BASE_URL ya kwako inatumika (slash ya mwisho inaondolewa)', async () => {
    const spy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 'Ok', routes: [{ distance: 1000, duration: 60 }] }),
    });
    global.fetch = spy as any;
    await make(undefined, {
      ROUTING_PROVIDER: 'osrm',
      OSRM_BASE_URL: 'https://osrm.example.co.tz/',
    }).getDistance(from, to);
    expect(spy.mock.calls[0][0]).toMatch(/^https:\/\/osrm\.example\.co\.tz\/route\/v1\/driving\//);
  });

  it('OSRM ikishindwa (code si Ok): makadirio, si kosa', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 'NoRoute', message: 'Impossible route' }),
    }) as any;
    const r = await make(undefined, { ROUTING_PROVIDER: 'osrm' }).getDistance(from, to);
    expect(r.source).toBe('estimate');
  });

  it('mtandao ukikatika: makadirio', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;
    const r = await make(undefined, { ROUTING_PROVIDER: 'osrm' }).getDistance(from, to);
    expect(r.source).toBe('estimate');
  });

  it('bila ROUTING_PROVIDER na bila key: haipigi mtandao kabisa', async () => {
    const spy = jest.fn();
    global.fetch = spy as any;
    const r = await make().getDistance(from, to);
    expect(r.source).toBe('estimate');
    expect(spy).not.toHaveBeenCalled();
  });

  it('ROUTING_PROVIDER=google bila key: makadirio, haipigi mtandao', async () => {
    const spy = jest.fn();
    global.fetch = spy as any;
    const r = await make(undefined, { ROUTING_PROVIDER: 'google' }).getDistance(from, to);
    expect(r.source).toBe('estimate');
    expect(spy).not.toHaveBeenCalled();
  });
});
