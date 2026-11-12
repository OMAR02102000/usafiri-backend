import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { Public } from '../common/auth';
import { PaymentsService, WebhookPayload } from './payments.service';

@Controller('webhooks')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Callback ya mtoa huduma malipo yakipokelewa. Haitumii token ya kawaida;
   * inathibitishwa kwa saini (header x-signature) ya mwili ghafi.
   * Muundo wa ujumbe na jina la header vitarekebishwa kulingana na mtoa huduma utakayemchagua.
   */
  @Public()
  @Post('payments')
  @HttpCode(200)
  async webhook(
    @Req() req: { rawBody?: Buffer; body: WebhookPayload },
    @Headers('x-signature') signature?: string,
  ) {
    if (!this.payments.verifySignature(req.rawBody, signature)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Saini si sahihi.');
    }
    return this.payments.recordPayment(req.body);
  }
}
