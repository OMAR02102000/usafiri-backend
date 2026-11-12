# Usafiri Backend (NestJS + PostgreSQL)

Backend ya mfumo wa usafiri, kulingana na Nyaraka za Mfumo, Muundo wa API na Muundo wa Database tulizoandika.

Inahudumia app ya abiria (bila kujisajili), app ya mmiliki na dereva, na dashboard ya admin.

## Kilichomo na kimejaribiwa

Majaribio 52 yanapita (18 ya unit na 34 ya mtiririko mzima kwenye PostgreSQL 16, Node 22):

| Eneo | Kinachofanya kazi |
| --- | --- |
| Abiria | Kikao cha kifaa bila kujisajili, makadirio ya nauli, kuomba safari, kuona dereva, kughairi, rating, historia |
| Nauli | Inahesabiwa na server: `baseFare + km x perKm`, isiwe chini ya nauli ya chini. `quote_id` iliyosainiwa inahakikisha nauli iliyoonyeshwa ndiyo inayotumika |
| Kuunganisha | Chombo cha aina aliyoomba, online, kimethibitishwa, GPS mpya, ndani ya radius, kisicho na safari. Ombi linaenda kwa kilicho karibu zaidi; kikikataa au kikichelewa (sekunde 25), linaenda kwa kinachofuata; vikiisha, `no_driver` |
| Mmiliki | OTP, kujisajili, kusajili vyombo na dereva, Online/Offline, GPS, kukubali/kukataa, hatua za safari, historia, ankara |
| Admin | Order zote, kuthibitisha/kukataa/kuzuia wamiliki na vyombo, kuzuia abiria, bei na ada, ankara, ripoti, audit log |
| Ada ya mwezi | Ankara moja kwa mmiliki kwa mwezi (mfano TZS 5,000), control number, malipo kamili na pungufu, callback isiyorudiwa mara mbili |

## Mambo ambayo bado hayapo (muhimu kujua)

- **SMS ya OTP:** kwenye maendeleo OTP inarudishwa kwenye jibu (`dev_code`) na kuandikwa kwenye console. Kwenye `NODE_ENV=production` kutuma kunashindwa wazi hadi uunganishe mtoa huduma wa SMS ndani ya `src/auth/sms.service.ts`.
- **Control number:** zinazotolewa sasa ni za kuigiza (`PAYMENT_PROVIDER=mock`), hazilipiki popote. Kwenye production, mtoa huduma wa mock anakataa kufanya kazi. Ukishachagua GePG, Selcom, ClickPesa au AzamPay, tekeleza interface ya `PaymentProvider` (`src/payments/payment-provider.ts`) na ubadilishe muundo wa webhook kulingana na hati zao.
- **Moja kwa moja:** hakuna WebSocket wala arifa za Firebase bado. App inauliza hali kila sekunde chache: abiria `GET /rides/{id}`, dereva `GET /offers`, GPS `POST /vehicles/{id}/location`. Inatosha kwa majaribio na pilot ndogo.
- **Migrations:** hazijaandikwa. `DB_SYNC=true` inatengeneza majedwali kiotomatiki na ni kwa maendeleo tu. Kabla ya uzinduzi, tengeneza migrations na uweke `DB_SYNC=false`.
- **Picha:** vyombo vinapokea URL za picha na leseni (`photo_url`, `license_url`), lakini hakuna endpoint ya kupakia faili bado.
- **Umbali:** bila `GOOGLE_MAPS_API_KEY`, umbali unakadiriwa kwa mstari wa moja kwa moja mara 1.35. Ukiweka key, Routes API inatumika (key ya server iwe na Routes API imewashwa).
- **Ada:** ankara moja kwa mmiliki, si kwa chombo (bado ni swali la kuthibitisha). Mmiliki anayethibitishwa katikati ya mwezi analipa ada kamili ya mwezi huo, na siku ya mwisho ikiwa imepita anapewa siku 7.

## Kuanza

Unahitaji Node.js 18 au zaidi na PostgreSQL.

1. Tengeneza database (PowerShell, badilisha `postgres` kama mtumiaji wako ni tofauti):

   ```powershell
   psql -U postgres -c "CREATE DATABASE usafiri"
   ```

2. Kwenye folda ya project:

   ```powershell
   npm install
   copy .env.example .env
   ```

3. Fungua `.env` na ujaze:
   - `DATABASE_URL`: `postgres://postgres:PASSWORD_YAKO@localhost:5432/usafiri`
   - `JWT_SECRET`: maneno marefu ya nasibu
   - `ADMIN_EMAIL` na `ADMIN_PASSWORD`: admin wa kwanza (anatengenezwa mara ya kwanza backend inapowaka)
   - `GOOGLE_MAPS_API_KEY`: hiari (key ya server, tofauti na ya app)

4. Washa:

   ```powershell
   npm run start:dev
   ```

   Backend inaonekana kwenye `http://localhost:3000/api/v1`.

Ukitumia Docker badala ya PostgreSQL iliyosakinishwa: `docker compose up -d` (inatumia mtumiaji `postgres`, password `postgres`, database `usafiri`).

## Kujaribu

```powershell
npm test                 # unit
npm run test:e2e         # mtiririko mzima
```

`test:e2e` inahitaji database tupu ya majaribio na **inaifuta kila inapoanza**:

```powershell
psql -U postgres -c "CREATE DATABASE usafiri_test"
$env:TEST_DATABASE_URL="postgres://postgres:PASSWORD_YAKO@localhost:5432/usafiri_test"
npm run test:e2e
```

Usiielekeze kwenye database yenye data halisi.

## Kuunganisha app ya Flutter

Kwenye emulator ya Android, kompyuta yako inaonekana kama `10.0.2.2`:

```powershell
flutter run --dart-define=MAPS_API_KEY=KEY_YAKO --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

Kwa simu halisi kwenye mtandao ule ule wa WiFi, tumia anwani ya IP ya kompyuta yako (mfano `http://192.168.1.10:3000/api/v1`), na uruhusu bandari 3000 kwenye firewall.

Android inazuia `http://` kwa chaguo-msingi. Kwa majaribio, ongeza kwenye `<application ...>` ya `AndroidManifest.xml`:

```xml
android:usesCleartextTraffic="true"
```

Iondoe kabla ya uzinduzi; production itumie HTTPS.

## Mtiririko wa kujaribu kwa mkono

Tumia Postman au `curl`. Njia zote zina kiambishi `/api/v1`.

1. **Admin anaingia:** `POST /admin/auth/login` na `{"email","password"}` kutoka `.env`. Hifadhi `token`.
2. **Mmiliki anajisajili:** `POST /auth/otp/request` na `{"phone":"0712345678"}`; chukua `dev_code`; `POST /auth/otp/verify` na `{"phone","code"}`; kisha `POST /owners` na `{"name":"..."}` kwa token ya `new`. Hifadhi token ya mmiliki.
3. **Chombo:** `POST /vehicles` na `{"type":"bodaboda","plate_no":"MC 123 ABC"}`.
4. **Admin anathibitisha:** `PATCH /admin/owners/{id}/status` na `{"status":"approved"}`, kisha `PATCH /admin/vehicles/{id}/status` na `{"status":"approved"}`. Mmiliki anapata ankara ya mwezi (`GET /owners/me/invoices`).
5. **Online:** `POST /vehicles/{id}/online` na `{"lat":-6.1665,"lng":39.203}`.
6. **Abiria:** `POST /passengers/session` na `{"device_id":"kitambulisho-cha-majaribio"}`, kisha `POST /rides` na aina, `pickup`, `dropoff`, `name`, `phone`. Eneo la `pickup` liwe ndani ya km 3 kutoka kwa chombo.
7. **Dereva:** `GET /offers`, `POST /rides/{id}/accept`, `arrived`, `start`, `complete`.
8. **Malipo ya ada (kuigiza):** `POST /admin/invoices/{id}/mock-pay`.

## Dashboard ya admin (web)

Backend ikiwaka, fungua kwenye browser: **http://localhost:3000/admin** na uingie kwa `ADMIN_EMAIL` na `ADMIN_PASSWORD`.

Ina: muhtasari, order zote, kuthibitisha/kukataa/kuzuia wamiliki na vyombo, ankara na control number (pamoja na kuigiza malipo kwa majaribio), kuzuia abiria, na kubadilisha bei, ada na mipangilio. Faili ziko `public/admin/`.

## Majukumu ya admin

| Cheo | Anaweza |
| --- | --- |
| `super_admin` | Yote |
| `support` | Kuthibitisha na kuzuia wamiliki, vyombo na abiria |
| `finance` | Bei, ada na ankara |

Admin wa kwanza ni `super_admin`. Kutengeneza admin wengine bado hakuna endpoint; ongeza mwenyewe kwenye jedwali la `admins` (password iwe imefichwa kwa bcrypt).

## Muundo wa folda

```text
src/
  auth/        OTP, kikao cha abiria, kuingia kwa admin
  vehicles/    usajili wa vyombo, Online/Offline, GPS
  owners/      kujisajili mmiliki, safari na ankara zake
  rides/       ombi la safari, kuunganisha (dispatch), hatua za safari
  payments/    ankara za mwezi, control number, webhook
  admin/       order, uthibitisho, kuzuia, bei na ada, ripoti
  shared/      bei, umbali, nauli, mipangilio, audit
  entities/    majedwali ya database
test/          jaribio la mtiririko mzima (e2e)
```
