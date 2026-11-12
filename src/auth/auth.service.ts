import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { MoreThan, Repository } from 'typeorm';
import { AppError } from '../common/app-error';
import { AuthUser } from '../common/auth';
import { normalizeTzPhone } from '../common/phone';
import { Admin, Driver, Owner, OtpCode, Passenger } from '../entities';
import { SmsService } from './sms.service';

const OTP_TTL_MIN = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS_PER_HOUR = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    @InjectRepository(Passenger) private readonly passengers: Repository<Passenger>,
    @InjectRepository(Owner) private readonly owners: Repository<Owner>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    @InjectRepository(OtpCode) private readonly otps: Repository<OtpCode>,
  ) {}

  // ---------- Abiria: kikao cha kifaa, bila kujisajili ----------

  async passengerSession(deviceId: string) {
    let p = await this.passengers.findOneBy({ deviceId });
    if (!p) {
      p = await this.passengers.save(
        this.passengers.create({ deviceId, name: null, phone: null, status: 'active' }),
      );
    }
    if (p.status === 'blocked') {
      throw new AppError(403, 'PASSENGER_BLOCKED', 'Kifaa hiki kimezuiwa.');
    }
    const token = await this.jwt.signAsync({ sub: p.id, role: 'passenger' } satisfies AuthUser);
    return { device_token: token };
  }

  // ---------- Mmiliki na dereva: namba ya simu na OTP ----------

  private hashCode(code: string, phone: string): string {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    return createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
  }

  async requestOtp(rawPhone: string) {
    const phone = normalizeTzPhone(rawPhone);
    if (!phone) {
      throw new AppError(400, 'INVALID_PHONE', 'Namba ya simu si sahihi.');
    }

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.otps.count({
      where: { phone, createdAt: MoreThan(hourAgo) },
    });
    if (recent >= OTP_MAX_REQUESTS_PER_HOUR) {
      throw new AppError(
        429,
        'OTP_RATE_LIMIT',
        'Umeomba OTP mara nyingi. Jaribu tena baada ya saa moja.',
      );
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.otps.save({
      phone,
      codeHash: this.hashCode(code, phone),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60 * 1000),
      attempts: 0,
      used: false,
    });
    await this.sms.send(phone, `Namba yako ya uthibitisho ni ${code}. Inaisha baada ya dakika ${OTP_TTL_MIN}.`);

    // dev_code inarudishwa kwenye maendeleo tu, ili kujaribu bila SMS.
    return this.sms.isDev
      ? { sent: true, dev_code: code }
      : { sent: true };
  }

  async verifyOtp(rawPhone: string, code: string) {
    const phone = normalizeTzPhone(rawPhone);
    if (!phone) {
      throw new AppError(400, 'INVALID_PHONE', 'Namba ya simu si sahihi.');
    }

    const otp = await this.otps.findOne({
      where: { phone, used: false, expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppError(400, 'OTP_INVALID', 'OTP si sahihi au imeisha muda. Omba mpya.');
    }

    const expected = Buffer.from(otp.codeHash);
    const given = Buffer.from(this.hashCode(code, phone));
    const ok = expected.length === given.length && timingSafeEqual(expected, given);
    if (!ok) {
      await this.otps.update(otp.id, { attempts: otp.attempts + 1 });
      throw new AppError(400, 'OTP_INVALID', 'OTP si sahihi au imeisha muda. Omba mpya.');
    }
    await this.otps.update(otp.id, { used: true });

    const owner = await this.owners.findOneBy({ phone });
    if (owner) {
      if (owner.status === 'blocked') {
        throw new AppError(403, 'OWNER_BLOCKED', 'Akaunti hii imezuiwa.');
      }
      return this.sign({ sub: owner.id, role: 'owner', phone }, { registered: true, status: owner.status });
    }

    const driver = await this.drivers.findOneBy({ phone });
    if (driver) {
      if (driver.status === 'blocked') {
        throw new AppError(403, 'DRIVER_BLOCKED', 'Akaunti hii imezuiwa.');
      }
      return this.sign({ sub: driver.id, role: 'driver', phone }, { registered: true });
    }

    // Namba imethibitishwa lakini haijasajiliwa: token fupi ya kujisajili kama mmiliki.
    return this.sign({ sub: phone, role: 'new', phone }, { registered: false }, '30m');
  }

  // ---------- Admin ----------

  async adminLogin(email: string, password: string) {
    const admin = await this.admins.findOneBy({ email: email.trim().toLowerCase() });
    const ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
    if (!admin || !ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email au password si sahihi.');
    }
    const token = await this.jwt.signAsync(
      { sub: admin.id, role: 'admin', adminRole: admin.role } satisfies AuthUser,
      { expiresIn: '12h' },
    );
    return { token, admin: { id: admin.id, name: admin.name, role: admin.role } };
  }

  // ---------- Token ----------

  async signOwner(owner: Owner) {
    return this.sign(
      { sub: owner.id, role: 'owner', phone: owner.phone },
      { registered: true, status: owner.status },
    );
  }

  /** Token mpya kwa mtumiaji aliyeingia (bila kuingia tena). */
  async refresh(user: AuthUser) {
    const { sub, role, phone, adminRole } = user;
    const expiresIn = role === 'admin' ? '12h' : role === 'new' ? '30m' : undefined;
    const token = await this.jwt.signAsync(
      { sub, role, phone, adminRole } as AuthUser,
      expiresIn ? { expiresIn: expiresIn as any } : undefined,
    );
    return { token };
  }

  private async sign(
    payload: AuthUser,
    extra: Record<string, unknown>,
    expiresIn?: string,
  ) {
    const token = await this.jwt.signAsync(
      payload,
      expiresIn ? { expiresIn: expiresIn as any } : undefined,
    );
    return { token, role: payload.role, ...extra };
  }
}
