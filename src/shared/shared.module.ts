import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '../entities';
import { DistanceService } from './distance.service';
import { FaresService } from './fares.service';
import { AuditService, SettingsService } from './settings.service';

/** Vitu vinavyotumiwa na modules zote: repositories, JWT, bei, umbali, audit. */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature(ALL_ENTITIES),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '30d' } as any,
      }),
    }),
  ],
  providers: [SettingsService, AuditService, DistanceService, FaresService],
  exports: [
    TypeOrmModule,
    JwtModule,
    SettingsService,
    AuditService,
    DistanceService,
    FaresService,
  ],
})
export class SharedModule {}
