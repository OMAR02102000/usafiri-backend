import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import {
  CreateVehicleDto,
  LocationDto,
  OnlineDto,
  UpdateVehicleDto,
} from './vehicles.dto';
import { VehiclesService } from './vehicles.service';

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Post()
  @Roles('owner')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateVehicleDto) {
    return this.vehicles.toView(await this.vehicles.create(user.sub, dto));
  }

  @Get()
  @Roles('owner', 'driver')
  async list(@CurrentUser() user: AuthUser) {
    const list = await this.vehicles.listFor(user);
    return { vehicles: list.map((v) => this.vehicles.toView(v)) };
  }

  @Patch(':id')
  @Roles('owner')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehicles.toView(await this.vehicles.update(user.sub, id, dto));
  }

  @Post(':id/online')
  @Roles('owner', 'driver')
  @HttpCode(200)
  async online(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OnlineDto,
  ) {
    return this.vehicles.toView(await this.vehicles.setOnline(user, id, dto.lat, dto.lng));
  }

  @Post(':id/offline')
  @Roles('owner', 'driver')
  @HttpCode(200)
  async offline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.toView(await this.vehicles.setOffline(user, id));
  }

  /** GPS ya chombo. (Baadaye WebSocket itachukua nafasi ya hii kwa masasisho ya mara kwa mara.) */
  @Post(':id/location')
  @Roles('owner', 'driver')
  @HttpCode(200)
  location(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LocationDto,
  ) {
    return this.vehicles.updateLocation(user, id, dto.lat, dto.lng);
  }
}
