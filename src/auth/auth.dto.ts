import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class PassengerSessionDto {
  @IsString()
  @Length(8, 128)
  device_id: string;
}

export class OtpRequestDto {
  @IsString()
  @MaxLength(20)
  phone: string;
}

export class OtpVerifyDto {
  @IsString()
  @MaxLength(20)
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class AdminLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}
