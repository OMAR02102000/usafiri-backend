import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { CreateRideDto, EstimateDto, RatingDto } from './rides.dto';
import { RidesService } from './rides.service';

@Controller()
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  // ---------- Abiria ----------

  @Post('fares/estimate')
  @Roles('passenger')
  @HttpCode(200)
  estimate(@Body() dto: EstimateDto) {
    return this.rides.estimate(dto);
  }

  @Post('rides')
  @Roles('passenger')
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRideDto) {
    return this.rides.create(user.sub, dto);
  }

  @Get('rides')
  @Roles('passenger')
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.rides.listForPassenger(user.sub, Number(limit) || 50, Number(offset) || 0);
  }

  @Get('rides/:id')
  @Roles('passenger', 'owner', 'driver')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return user.role === 'passenger'
      ? this.rides.getForPassenger(user.sub, id)
      : this.rides.getForDriver(user, id);
  }

  @Post('rides/:id/cancel')
  @Roles('passenger')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.cancel(user.sub, id);
  }

  @Post('rides/:id/rating')
  @Roles('passenger')
  @HttpCode(200)
  rate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RatingDto,
  ) {
    return this.rides.rate(user.sub, id, dto);
  }

  // ---------- Dereva / mmiliki ----------

  /** Maombi yanayosubiri jibu (polling; WebSocket itaongezwa baadaye). */
  @Get('offers')
  @Roles('owner', 'driver')
  offers(@CurrentUser() user: AuthUser) {
    return this.rides.offersFor(user);
  }

  @Post('rides/:id/accept')
  @Roles('owner', 'driver')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.accept(user, id);
  }

  @Post('rides/:id/reject')
  @Roles('owner', 'driver')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.reject(user, id);
  }

  @Post('rides/:id/arrived')
  @Roles('owner', 'driver')
  @HttpCode(200)
  arrived(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.arrived(user, id);
  }

  @Post('rides/:id/start')
  @Roles('owner', 'driver')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.start(user, id);
  }

  @Post('rides/:id/complete')
  @Roles('owner', 'driver')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.complete(user, id);
  }
}
