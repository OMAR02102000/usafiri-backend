import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SmsService } from './auth/sms.service';
import { AuthGuard } from './common/auth';
import { ALL_ENTITIES } from './entities';
import { OwnersController } from './owners/owners.controller';
import { PaymentsModule } from './payments/payments.module';
import { DispatchService } from './rides/dispatch.service';
import { RidesController } from './rides/rides.controller';
import { RidesService } from './rides/rides.service';
import { SeedService } from './shared/seed.service';
import { SharedModule } from './shared/shared.module';
import { VehiclesController } from './vehicles/vehicles.controller';
import { VehiclesService } from './vehicles/vehicles.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: ALL_ENTITIES,
        // DB_SYNC=true inatengeneza majedwali kiotomatiki (maendeleo tu).
        synchronize: config.get<string>('DB_SYNC') === 'true',
      }),
    }),
    SharedModule,
    PaymentsModule,
  ],
  controllers: [
    AuthController,
    VehiclesController,
    OwnersController,
    RidesController,
    AdminController,
  ],
  providers: [
    AuthService,
    SmsService,
    VehiclesService,
    RidesService,
    DispatchService,
    SeedService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
