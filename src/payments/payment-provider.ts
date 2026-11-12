import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { AppError } from '../common/app-error';
import { Invoice, Owner } from '../entities';

/**
 * Mtoa huduma wa control number (GePG, Selcom, ClickPesa, AzamPay, n.k.).
 * Ukishachagua mtoa huduma, tengeneza darasa linalotekeleza interface hii
 * na ulichague ndani ya PaymentsModule kulingana na PAYMENT_PROVIDER.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Inaomba control number kwa ankara moja. */
  requestControlNumber(invoice: Invoice, owner: Owner): Promise<string>;
}

/**
 * Mtoa huduma wa kuigiza kwa maendeleo na majaribio.
 * Control number zake SI halisi na hazilipiki popote.
 * Kwenye production inakataa kufanya kazi, ili control number za uongo zisifike kwa wamiliki.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  constructor(private readonly config: ConfigService) {}

  async requestControlNumber(): Promise<string> {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new AppError(
        503,
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'Mtoa huduma wa malipo hajaunganishwa. Control number haziwezi kutolewa.',
      );
    }
    // Muundo unaofanana na control number (tarakimu 12, inaanza na 99), lakini ni ya kuigiza.
    let digits = '99';
    for (let i = 0; i < 10; i++) digits += String(randomInt(0, 10));
    return digits;
  }
}
