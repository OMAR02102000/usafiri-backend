import { haversineKm } from '../common/geo';
import { normalizeTzPhone } from '../common/phone';
import { computeFare } from './fares.service';

describe('computeFare', () => {
  const boda = { baseFare: 1000, perKm: 500, minFare: 2000 };
  const bajaji = { baseFare: 1500, perKm: 800, minFare: 3000 };
  const taxi = { baseFare: 3000, perKm: 1200, minFare: 5000 };

  it('bodaboda km 6 = 4,000', () => expect(computeFare(boda, 6)).toBe(4000));
  it('bajaji km 10 = 9,500', () => expect(computeFare(bajaji, 10)).toBe(9500));
  it('taxi km 5 = 9,000', () => expect(computeFare(taxi, 5)).toBe(9000));
  it('umbali mfupi unatumia nauli ya chini', () => {
    expect(computeFare(boda, 0.5)).toBe(2000);
    expect(computeFare(taxi, 0)).toBe(5000);
  });
  it('umbali hasi unachukuliwa kama sifuri', () => expect(computeFare(boda, -4)).toBe(2000));
  it('nauli ni namba kamili', () => expect(computeFare(boda, 3.3)).toBe(2650));
});

describe('normalizeTzPhone', () => {
  it.each([
    ['0712345678', '+255712345678'],
    ['712345678', '+255712345678'],
    ['255712345678', '+255712345678'],
    ['+255 712 345 678', '+255712345678'],
    ['0612345678', '+255612345678'],
  ])('%s -> %s', (input, out) => expect(normalizeTzPhone(input)).toBe(out));

  it.each(['', '123', '0112345678', '07123456', 'abc'])('"%s" si sahihi', (input) =>
    expect(normalizeTzPhone(input)).toBeNull(),
  );
});

describe('haversineKm', () => {
  it('sifuri kwa nukta ileile', () => {
    expect(haversineKm({ lat: -6.8, lng: 39.2 }, { lat: -6.8, lng: 39.2 })).toBe(0);
  });
  it('digrii 1 ya latitudo ni takriban km 111', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.2, 0);
  });
});
