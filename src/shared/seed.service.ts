import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Admin, FareRate, Setting, VEHICLE_TYPES } from '../entities';
import { DEFAULT_RATES, DEFAULT_SETTINGS } from './settings.service';

/** Inaweka bei, mipangilio na admin wa kwanza kama bado havipo. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    @InjectRepository(FareRate) private readonly rates: Repository<FareRate>,
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
  ) {}

  async onApplicationBootstrap() {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(await this.settings.findOneBy({ key }))) {
        await this.settings.save({ key, value, updatedBy: null });
      }
    }
    for (const type of VEHICLE_TYPES) {
      if (!(await this.rates.findOneBy({ vehicleType: type }))) {
        await this.rates.save({ vehicleType: type, ...DEFAULT_RATES[type], updatedBy: null });
      }
    }

    if ((await this.admins.count()) === 0) {
      const email = this.config.get<string>('ADMIN_EMAIL');
      const password = this.config.get<string>('ADMIN_PASSWORD');
      if (!email || !password) {
        this.logger.warn(
          'Hakuna admin. Weka ADMIN_EMAIL na ADMIN_PASSWORD kwenye .env ili kutengeneza wa kwanza.',
        );
        return;
      }
      await this.admins.save({
        name: this.config.get<string>('ADMIN_NAME') ?? 'Administrator',
        email: email.trim().toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        role: 'super_admin',
      });
      this.logger.log(`Admin wa kwanza ametengenezwa: ${email}`);
    }
  }
}
