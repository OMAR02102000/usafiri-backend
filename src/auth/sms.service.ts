import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/app-error';

/**
 * Kutuma SMS (OTP). Bado hakuna mtoa huduma aliyeunganishwa.
 *
 * Kwenye maendeleo, ujumbe unaandikwa kwenye console. Kwenye uzalishaji (NODE_ENV=production),
 * kutuma kunashindwa kwa wazi hadi uunganishe mtoa huduma wa SMS hapa, ili OTP zisipotee kimya.
 * Weka msimbo wa mtoa huduma wako (Africa's Talking, Beem, Twilio, n.k.) ndani ya send().
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  get isDev(): boolean {
    return this.config.get<string>('NODE_ENV') !== 'production';
  }

  async send(phone: string, text: string): Promise<void> {
    if (this.isDev) {
      this.logger.warn(`[SMS ya majaribio] kwenda ${phone}: ${text}`);
      return;
    }
    throw new AppError(
      503,
      'SMS_NOT_CONFIGURED',
      'Huduma ya SMS haijaunganishwa. Wasiliana na msimamizi.',
    );
  }
}
