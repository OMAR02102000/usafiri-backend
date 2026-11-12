/**
 * Jaribio la mtiririko mzima: usajili wa mmiliki, uthibitisho wa admin, kuomba safari,
 * kuunganisha na chombo kilicho karibu, hali za safari, nauli, ada ya mwezi na malipo.
 *
 * Inahitaji PostgreSQL na database tupu ya majaribio:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/usafiri_test npm run test:e2e
 * Database inafutwa kila jaribio linapoanza. USIITUMIE kwenye database yenye data halisi.
 */
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { Client } from 'pg';
import request from 'supertest';

const DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/usafiri_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = DB_URL;
process.env.DB_SYNC = 'true';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.PAYMENT_WEBHOOK_SECRET = 'webhook-secret';
process.env.GOOGLE_MAPS_API_KEY = ''; // majaribio yasitegemee Google

const API = '/api/v1';
const PICKUP = { lat: -6.1659, lng: 39.2026, address: 'Mahali A' };
const DROPOFF = { lat: -6.13, lng: 39.27, address: 'Mahali B' };

describe('Mtiririko mzima wa mfumo', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let dispatch: { expireOffers(): Promise<void> };

  let adminToken = '';
  let ownerToken = '';
  let ownerId = '';
  let vehicleA = ''; // karibu sana na abiria
  let vehicleB = ''; // mbali kidogo (ndani ya radius)
  let passengerToken = '';
  let rideId = '';
  let invoice: { id: string; control_number: string; amount: number; status: string };

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, t?: string) => request(app.getHttpServer()).get(API + path).set(t ? auth(t) : {});
  const post = (path: string, body: object = {}, t?: string) =>
    request(app.getHttpServer()).post(API + path).set(t ? auth(t) : {}).send(body);
  const patch = (path: string, body: object, t: string) =>
    request(app.getHttpServer()).patch(API + path).set(auth(t)).send(body);
  const put = (path: string, body: object, t: string) =>
    request(app.getHttpServer()).put(API + path).set(auth(t)).send(body);

  const sign = (raw: string) => createHmac('sha256', 'webhook-secret').update(raw).digest('hex');
  const webhook = (payload: object, signature?: string) => {
    const raw = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post(`${API}/webhooks/payments`)
      .set('content-type', 'application/json')
      .set('x-signature', signature ?? sign(raw))
      .send(raw);
  };

  async function newPassenger(deviceId: string) {
    const r = await post('/passengers/session', { device_id: deviceId });
    expect(r.status).toBe(200);
    return r.body.device_token as string;
  }

  async function loginOtp(phone: string) {
    const req = await post('/auth/otp/request', { phone });
    expect(req.status).toBe(200);
    expect(req.body.dev_code).toMatch(/^\d{6}$/);
    return post('/auth/otp/verify', { phone, code: req.body.dev_code });
  }

  beforeAll(async () => {
    // Database tupu kila mara.
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.end();

    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/main');
    const { DispatchService } = await import('../src/rides/dispatch.service');

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureApp(app);
    await app.init();
    dispatch = app.get(DispatchService);
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------- Usalama wa msingi

  it('bila token inakataliwa (401) na token ya abiria haifungui admin (403)', async () => {
    expect((await get('/offers')).status).toBe(401);
    passengerToken = await newPassenger('device-passenger-0001');
    expect((await get('/admin/rides', passengerToken)).status).toBe(403);
    expect((await get('/admin/rides', 'token-ya-uongo')).status).toBe(401);
  });

  it('admin wa kwanza anaingia; password mbaya inakataliwa', async () => {
    const bad = await post('/admin/auth/login', { email: 'admin@test.local', password: 'si-sahihi' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');

    const ok = await post('/admin/auth/login', { email: 'ADMIN@test.local', password: 'admin-pass-123' });
    expect(ok.status).toBe(200);
    adminToken = ok.body.token;
  });

  // ---------------------------------------------------------------- Mmiliki

  it('OTP isiyo sahihi inakataliwa; OTP sahihi inatoa token ya kujisajili', async () => {
    const phone = '0712000001';
    const req = await post('/auth/otp/request', { phone });
    const wrong = req.body.dev_code === '000000' ? '111111' : '000000';
    const bad = await post('/auth/otp/verify', { phone, code: wrong });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('OTP_INVALID');

    const ok = await post('/auth/otp/verify', { phone, code: req.body.dev_code });
    expect(ok.status).toBe(200);
    expect(ok.body.registered).toBe(false);
    expect(ok.body.role).toBe('new');

    const reg = await post('/owners', { name: 'Mmiliki Mmoja' }, ok.body.token);
    expect(reg.status).toBe(201);
    expect(reg.body.owner.status).toBe('pending');
    ownerToken = reg.body.token;
    ownerId = reg.body.owner.id;

    // Kujisajili mara ya pili kwa token ya "new" iliyokwisha tumika kunakataliwa.
    const again = await post('/owners', { name: 'Mwingine' }, ok.body.token);
    expect(again.status).toBe(409);
  });

  it('mmiliki anasajili vyombo viwili; plate iliyorudiwa inakataliwa', async () => {
    const a = await post('/vehicles', { type: 'bodaboda', plate_no: 'mc 111 aaa' }, ownerToken);
    expect(a.status).toBe(201);
    expect(a.body.plate_no).toBe('MC 111 AAA');
    expect(a.body.approval_status).toBe('pending');
    vehicleA = a.body.id;

    const b = await post('/vehicles', { type: 'bodaboda', plate_no: 'MC 222 BBB' }, ownerToken);
    vehicleB = b.body.id;

    const dup = await post('/vehicles', { type: 'bajaji', plate_no: 'MC 111 AAA' }, ownerToken);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PLATE_EXISTS');

    const badType = await post('/vehicles', { type: 'ndege', plate_no: 'XX 000 XX' }, ownerToken);
    expect(badType.status).toBe(400);
  });

  it('chombo ambacho hakijathibitishwa hakiwezi kuwa online', async () => {
    const r = await post(`/vehicles/${vehicleA}/online`, { lat: -6.1665, lng: 39.203 }, ownerToken);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('VEHICLE_NOT_APPROVED');
  });

  it('admin anathibitisha mmiliki na vyombo; mmiliki anapata ankara ya mwezi mara moja', async () => {
    const o = await patch(`/admin/owners/${ownerId}/status`, { status: 'approved' }, adminToken);
    expect(o.status).toBe(200);
    for (const id of [vehicleA, vehicleB]) {
      const v = await patch(`/admin/vehicles/${id}/status`, { status: 'approved' }, adminToken);
      expect(v.status).toBe(200);
    }

    const inv = await get('/owners/me/invoices', ownerToken);
    expect(inv.status).toBe(200);
    expect(inv.body.invoices).toHaveLength(1);
    invoice = inv.body.invoices[0];
    expect(invoice.amount).toBe(5000);
    expect(invoice.status).toBe('unpaid');
    expect(invoice.control_number).toMatch(/^99\d{10}$/);
  });

  it('mmiliki hawezi kugusa chombo cha mwingine, wala kutumia endpoint za admin', async () => {
    const otp = await loginOtp('0712000002');
    const reg = await post('/owners', { name: 'Mmiliki Wa Pili' }, otp.body.token);
    const other = reg.body.token as string;

    expect((await post(`/vehicles/${vehicleA}/online`, {}, other)).status).toBe(404);
    expect((await get('/admin/owners', other)).status).toBe(403);
    expect((await get('/vehicles', other)).body.vehicles).toHaveLength(0);
  });

  // ---------------------------------------------------------------- Nauli

  it('nauli inahesabiwa na server: bodaboda ya mfano', async () => {
    passengerToken = await newPassenger('device-passenger-0001');
    const r = await post('/fares/estimate', { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF }, passengerToken);
    expect(r.status).toBe(200);
    expect(r.body.distance_source).toBe('estimate'); // hakuna Google key kwenye jaribio
    expect(r.body.fare).toBe(1000 + Math.round(r.body.distance_km * 500));
    expect(r.body.fare).toBeGreaterThanOrEqual(2000);
    expect(r.body.quote_id).toBeTruthy();
  });

  it('eneo lisilo sahihi na umbali mrefu mno vinakataliwa', async () => {
    const bad = await post(
      '/fares/estimate',
      { vehicle_type: 'taxi', pickup: { lat: 200, lng: 0 }, dropoff: DROPOFF },
      passengerToken,
    );
    expect(bad.status).toBe(400);

    const far = await post(
      '/fares/estimate',
      { vehicle_type: 'taxi', pickup: PICKUP, dropoff: { lat: 10, lng: 50 } },
      passengerToken,
    );
    expect(far.status).toBe(400);
    expect(far.body.error.code).toBe('DISTANCE_TOO_LONG');
  });

  // ---------------------------------------------------------------- Safari

  it('hakuna chombo online: ombi linaisha kama "no_driver"', async () => {
    const r = await post(
      '/rides',
      { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF, name: 'Abiria Mmoja', phone: '0755000001' },
      passengerToken,
    );
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('no_driver');
  });

  it('vyombo vinaenda online na GPS; abiria anapewa chombo cha karibu zaidi', async () => {
    expect((await post(`/vehicles/${vehicleA}/online`, { lat: -6.1665, lng: 39.203 }, ownerToken)).status).toBe(200);
    expect((await post(`/vehicles/${vehicleB}/online`, { lat: -6.18, lng: 39.21 }, ownerToken)).status).toBe(200);

    const est = await post('/fares/estimate', { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF }, passengerToken);
    const r = await post(
      '/rides',
      {
        vehicle_type: 'bodaboda',
        pickup: PICKUP,
        dropoff: DROPOFF,
        name: 'Abiria Mmoja',
        phone: '0755000001',
        quote_id: est.body.quote_id,
      },
      passengerToken,
    );
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('requested');
    expect(r.body.fare).toBe(est.body.fare); // nauli iliyoonyeshwa ndiyo iliyotumika
    rideId = r.body.id;

    const offers = await get('/offers', ownerToken);
    expect(offers.body.offers).toHaveLength(1);
    expect(offers.body.offers[0].vehicle_id).toBe(vehicleA);
    expect(offers.body.offers[0].seconds_left).toBeGreaterThan(0);
    // Namba ya abiria haionekani kabla ya kukubali.
    expect(JSON.stringify(offers.body)).not.toContain('0755000001');
    expect(JSON.stringify(offers.body)).not.toContain('+255755000001');
  });

  it('abiria hawezi kuwa na safari mbili zinazoendelea', async () => {
    const r = await post(
      '/rides',
      { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF, name: 'Abiria Mmoja', phone: '0755000001' },
      passengerToken,
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
  });

  it('dereva akikataa, ombi linaenda kwa chombo kinachofuata', async () => {
    const rej = await post(`/rides/${rideId}/reject`, {}, ownerToken);
    expect(rej.status).toBe(200);

    const offers = await get('/offers', ownerToken);
    expect(offers.body.offers).toHaveLength(1);
    expect(offers.body.offers[0].vehicle_id).toBe(vehicleB);
  });

  it('muda ukiisha bila jibu, ombi linaenda kwa anayefuata; wote wakiisha, "no_driver"', async () => {
    // Tunaiga muda kuisha kwa kurudisha offer_expires_at nyuma.
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query(`UPDATE rides SET "offerExpiresAt" = now() - interval '1 minute' WHERE id = $1`, [rideId]);
    await c.end();

    await dispatch.expireOffers();

    const mine = await get(`/rides/${rideId}`, passengerToken);
    expect(mine.body.status).toBe('no_driver');
    expect((await get('/offers', ownerToken)).body.offers).toHaveLength(0);
  });

  it('dereva wawili hawawezi kuchukua ombi moja: mmoja tu anafanikiwa', async () => {
    const r = await post(
      '/rides',
      { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF, name: 'Abiria Mmoja', phone: '0755000001' },
      passengerToken,
    );
    rideId = r.body.id;
    expect(r.body.status).toBe('requested');

    const [a, b] = await Promise.all([
      post(`/rides/${rideId}/accept`, {}, ownerToken),
      post(`/rides/${rideId}/accept`, {}, ownerToken),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('abiria anaona taarifa za dereva; dereva anaona namba ya abiria baada ya kukubali', async () => {
    const p = await get(`/rides/${rideId}`, passengerToken);
    expect(p.body.status).toBe('accepted');
    expect(p.body.driver.plate_no).toBe('MC 111 AAA');
    expect(p.body.driver.phone).toBe('+255712000001');
    expect(p.body.vehicle_location).toBeTruthy();

    const d = await get(`/rides/${rideId}`, ownerToken);
    expect(d.body.passenger.phone).toBe('+255755000001');
  });

  it('chombo chenye safari hakipewi ombi jingine', async () => {
    const other = await newPassenger('device-passenger-0002');
    const r = await post(
      '/rides',
      { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF, name: 'Abiria Wa Pili', phone: '0755000002' },
      other,
    );
    expect(r.status).toBe(201);
    // Chombo A kina safari; kinachofuata (B) ndicho kinachopewa.
    const offers = await get('/offers', ownerToken);
    expect(offers.body.offers[0].vehicle_id).toBe(vehicleB);
    await post(`/rides/${r.body.id}/cancel`, {}, other);
  });

  it('hatua za safari zinafuata mpangilio: dereva amefika, anza, kamilisha', async () => {
    // Kukamilisha kabla ya kuanza kunakataliwa.
    const early = await post(`/rides/${rideId}/complete`, {}, ownerToken);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_STATE');

    expect((await post(`/rides/${rideId}/arrived`, {}, ownerToken)).body.status).toBe('arrived');
    expect((await post(`/rides/${rideId}/start`, {}, ownerToken)).body.status).toBe('in_progress');

    // Safari ikishaanza haiwezi kughairiwa.
    const cancel = await post(`/rides/${rideId}/cancel`, {}, passengerToken);
    expect(cancel.status).toBe(409);

    expect((await post(`/rides/${rideId}/complete`, {}, ownerToken)).body.status).toBe('completed');
  });

  it('rating inaruhusiwa mara moja tu, baada ya safari kukamilika', async () => {
    const ok = await post(`/rides/${rideId}/rating`, { stars: 5, comment: 'Safi' }, passengerToken);
    expect(ok.status).toBe(200);
    expect((await post(`/rides/${rideId}/rating`, { stars: 4 }, passengerToken)).status).toBe(409);
    expect((await post(`/rides/${rideId}/rating`, { stars: 9 }, passengerToken)).status).toBe(400);
  });

  it('historia ya abiria na ya mmiliki zinaonyesha safari', async () => {
    const mine = await get('/rides', passengerToken);
    expect(mine.body.total).toBeGreaterThanOrEqual(2);
    const owner = await get('/owners/me/rides', ownerToken);
    expect(owner.body.rides.some((r: { id: string }) => r.id === rideId)).toBe(true);
  });

  it('abiria mwingine hawezi kuona safari ya mwenzake', async () => {
    const other = await newPassenger('device-passenger-0003');
    expect((await get(`/rides/${rideId}`, other)).status).toBe(404);
  });

  // ---------------------------------------------------------------- Admin

  it('admin anaona order zote na maelezo kamili', async () => {
    const list = await get('/admin/rides?status=completed', adminToken);
    expect(list.status).toBe(200);
    const row = list.body.rides.find((r: { id: string }) => r.id === rideId);
    expect(row.passenger.phone).toBe('+255755000001');
    expect(row.vehicle.plate_no).toBe('MC 111 AAA');

    const one = await get(`/admin/rides/${rideId}`, adminToken);
    expect(one.body.owner.name).toBe('Mmiliki Mmoja');
    expect(one.body.pickup.lat).toBeCloseTo(PICKUP.lat, 5);
  });

  it('admin anabadilisha bei: safari mpya zinatumia bei mpya, zilizopita hazibadiliki', async () => {
    const before = (await get(`/admin/rides/${rideId}`, adminToken)).body.fare;

    const res = await put(
      '/admin/settings/fare-rates',
      { rates: [{ vehicle_type: 'bodaboda', base_fare: 2000, per_km: 1000, min_fare: 3000 }] },
      adminToken,
    );
    expect(res.status).toBe(200);

    const est = await post('/fares/estimate', { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF }, passengerToken);
    expect(est.body.fare).toBe(2000 + Math.round(est.body.distance_km * 1000));
    expect((await get(`/admin/rides/${rideId}`, adminToken)).body.fare).toBe(before);

    // Rudisha bei za mwanzo.
    await put(
      '/admin/settings/fare-rates',
      { rates: [{ vehicle_type: 'bodaboda', base_fare: 1000, per_km: 500, min_fare: 2000 }] },
      adminToken,
    );
  });

  it('nauli (quote) isiyolingana na safari inakataliwa', async () => {
    const est = await post('/fares/estimate', { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF }, passengerToken);
    const r = await post(
      '/rides',
      {
        vehicle_type: 'taxi', // aina tofauti na quote
        pickup: PICKUP,
        dropoff: DROPOFF,
        name: 'Abiria Mmoja',
        phone: '0755000001',
        quote_id: est.body.quote_id,
      },
      passengerToken,
    );
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('QUOTE_MISMATCH');
  });

  // ---------------------------------------------------------------- Ada ya mwezi na malipo

  it('ankara za mwezi zinatengenezwa mara moja tu kwa mmiliki (hazirudiwi)', async () => {
    const first = await post('/admin/invoices/generate', {}, adminToken);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(0); // mmiliki alishapata ankara alipothibitishwa
    expect(first.body.existing).toBe(1);

    const list = await get(`/admin/invoices?owner_id=${ownerId}`, adminToken);
    expect(list.body.invoices).toHaveLength(1);
  });

  it('webhook yenye saini isiyo sahihi inakataliwa', async () => {
    const r = await webhook({ control_number: invoice.control_number, provider_ref: 'P1', amount: 5000 }, 'deadbeef');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('malipo pungufu yanaonekana "partial"; malipo ya pili yanamaliza', async () => {
    const part = await webhook({ control_number: invoice.control_number, provider_ref: 'P-100', amount: 2000 });
    expect(part.status).toBe(200);
    expect(part.body.status).toBe('partial');

    const rest = await webhook({ control_number: invoice.control_number, provider_ref: 'P-101', amount: 3000 });
    expect(rest.body.status).toBe('paid');

    const mine = await get('/owners/me/invoices', ownerToken);
    expect(mine.body.invoices[0].status).toBe('paid');
    expect(mine.body.invoices[0].paid_amount).toBe(5000);
  });

  it('ujumbe ule ule wa malipo ukifika mara mbili unahesabiwa mara moja', async () => {
    const dup = await webhook({ control_number: invoice.control_number, provider_ref: 'P-101', amount: 3000 });
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);

    const mine = await get('/owners/me/invoices', ownerToken);
    expect(mine.body.invoices[0].paid_amount).toBe(5000);
  });

  it('control number isiyojulikana inarudisha 404', async () => {
    const r = await webhook({ control_number: '990000000000', provider_ref: 'P-999', amount: 5000 });
    expect(r.status).toBe(404);
  });

  it('admin anaona hali ya malipo ya wamiliki', async () => {
    const r = await get('/admin/invoices?status=paid', adminToken);
    expect(r.body.invoices[0].owner.name).toBe('Mmiliki Mmoja');
    expect(r.body.invoices[0].control_number).toBe(invoice.control_number);
    expect(r.body.invoices[0].paid_at).toBeTruthy();
  });

  it('mabadiliko ya ada yanahusu ankara mpya tu', async () => {
    const r = await put('/admin/settings/owner-fee', { amount: 7000, due_day: 12 }, adminToken);
    expect(r.status).toBe(200);
    expect(r.body.owner_fee).toEqual({ amount: 7000, due_day: 12 });
    const mine = await get('/owners/me/invoices', ownerToken);
    expect(mine.body.invoices[0].amount).toBe(5000);
    await put('/admin/settings/owner-fee', { amount: 5000, due_day: 10 }, adminToken);
  });

  // ---------------------------------------------------------------- Kuzuia na ripoti

  it('ripoti ya admin inafanya kazi', async () => {
    const r = await get('/admin/reports/summary', adminToken);
    expect(r.status).toBe(200);
    expect(r.body.completed.count).toBeGreaterThanOrEqual(1);
    expect(r.body.owner_fees.by_status.length).toBeGreaterThanOrEqual(1);
    expect(r.body.vehicles.online).toBe(2);
  });

  it('abiria aliyezuiwa hawezi kuomba safari', async () => {
    const list = await get('/admin/passengers?phone=755000001', adminToken);
    const pid = list.body.passengers[0].id;
    expect((await post(`/admin/passengers/${pid}/block`, { reason: 'maombi ya uongo' }, adminToken)).status).toBe(200);

    const r = await post(
      '/rides',
      { vehicle_type: 'bodaboda', pickup: PICKUP, dropoff: DROPOFF, name: 'Abiria Mmoja', phone: '0755000001' },
      passengerToken,
    );
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('PASSENGER_BLOCKED');

    expect((await post(`/admin/passengers/${pid}/unblock`, {}, adminToken)).status).toBe(200);
  });

  it('mmiliki akizuiwa, vyombo vyake vinatoka online mara moja', async () => {
    expect((await patch(`/admin/owners/${ownerId}/status`, { status: 'blocked' }, adminToken)).status).toBe(200);
    const vehicles = await get('/admin/vehicles', adminToken);
    const mine = vehicles.body.vehicles.filter((v: { owner_id: string }) => v.owner_id === ownerId);
    expect(mine.length).toBe(2);
    expect(mine.every((v: { is_online: boolean }) => v.is_online === false)).toBe(true);

    // Hawezi tena kuingia.
    const login = await loginOtp('0712000001');
    expect(login.status).toBe(403);
  });
});
