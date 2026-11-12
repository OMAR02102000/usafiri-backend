import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import {
  AdminLoginDto,
  OtpRequestDto,
  OtpVerifyDto,
  PassengerSessionDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Abiria hajisajili: kifaa kinapata token kwa device_id yake. */
  @Public()
  @Post('passengers/session')
  @HttpCode(200)
  passengerSession(@Body() dto: PassengerSessionDto) {
    return this.auth.passengerSession(dto.device_id);
  }

  @Public()
  @Post('auth/otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public()
  @Post('auth/otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@CurrentUser() user: AuthUser) {
    return this.auth.refresh(user);
  }

  @Public()
  @Post('admin/auth/login')
  @HttpCode(200)
  adminLogin(@Body() dto: AdminLoginDto) {
    return this.auth.adminLogin(dto.email, dto.password);
  }
}
