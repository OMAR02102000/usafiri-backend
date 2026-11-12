import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { AppError } from '../common/app-error';
import { Invoice, Owner, Payment } from '../entities';
import { SettingsService } from '../shared/settings.service';
import { MockPaymentProvider, PaymentProvider } from './payment-provider';

const TZ = 'Africa/Dar_es_Salaam'; // UTC+3, hakuna saa ya kiangazi
const OFFSET_MS = 3 * 60 * 60 * 1000;

/** Tarehe ya leo kwa saa za Tanzania, kama "YYYY-MM-DD". */
export function todayTz(now = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Mwezi wa sasa kwa saa za Tanzania, kama "YYYY-MM". */
export function currentPeriod(now = new Date()): string {
  return todayTz(now).slice(0, 7);
}

export function isValidPeriod(p: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

export interface WebhookPayload {
  control_number: string;
  provider_ref: string;
  amount: number;
  paid_at?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly provider: PaymentProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    mock: MockPaymentProvider,
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Owner) private readonly owners: Repository<Owner>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
  ) {
    // Mtoa huduma halisi akiongezwa, mchague hapa kulingana na PAYMENT_PROVIDER.
    this.provider = mock;
  }

  // ---------- Kutengeneza ankara za kila mwezi ----------

  private async dueDateFor(period: string): Promise<string> {
    const day = Math.min(28, Math.max(1, await this.settings.getNumber('owner_fee_due_day')));
    const due = `${period}-${String(day).padStart(2, '0')}`;
    // Ankara inayotengenezwa baada ya siku ya mwisho (mfano mmiliki mpya katikati ya mwezi)
    // inapewa siku 7 za kulipa badala ya kuwa imechelewa tayari.
    const today = todayTz();
    if (due >= today) return due;
    return new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  }

  /**
   * Ankara moja kwa mmiliki kwa mwezi mmoja. Inaweza kuitwa mara nyingi bila madhara:
   * ikishakuwepo, inarudishwa ilivyo (na control number inaombwa tu kama bado haipo).
   */
  async ensureInvoice(owner: Owner, period: string): Promise<Invoice> {
    let invoice = await this.invoices.findOneBy({ ownerId: owner.id, period });

    if (!invoice) {
      const amount = await this.settings.getNumber('owner_monthly_fee');
      try {
        invoice = await this.invoices.save(
          this.invoices.create({
            ownerId: owner.id,
            period,
            amount,
            paidAmount: 0,
            controlNumber: null,
            status: 'unpaid',
            dueDate: await this.dueDateFor(period),
            paidAt: null,
          }),
        );
      } catch (e: any) {
        // Ombi mbili za wakati mmoja: moja inashinda, nyingine inasoma ankara iliyopo.
        if (e?.code !== '23505') throw e;
        invoice = await this.invoices.findOneByOrFail({ ownerId: owner.id, period });
      }
    }

    if (!invoice.controlNumber && invoice.status !== 'paid') {
      try {
        invoice.controlNumber = await this.provider.requestControlNumber(invoice, owner);
        await this.invoices.update(invoice.id, { controlNumber: invoice.controlNumber });
      } catch (e) {
        // Ankara inabaki bila control number; itajaribiwa tena wakati mwingine.
        this.logger.warn(`Control number imeshindwa kwa ankara ${invoice.id}: ${e}`);
      }
    }
    return invoice;
  }

  async generateForPeriod(period: string): Promise<{ period: string; created: number; existing: number }> {
    const owners = await this.owners.findBy({ status: 'approved' });
    let created = 0;
    let existing = 0;
    for (const o of owners) {
      const had = await this.invoices.existsBy({ ownerId: o.id, period });
      await this.ensureInvoice(o, period);
      if (had) existing++;
      else created++;
    }
    return { period, created, existing };
  }

  /** Kila tarehe 1 ya mwezi saa 00:05 (saa za Tanzania). */
  @Cron('5 0 1 * *', { timeZone: TZ })
  async monthlyJob() {
    try {
      const r = await this.generateForPeriod(currentPeriod());
      this.logger.log(`Ankara za ${r.period}: mpya ${r.created}, zilizokuwepo ${r.existing}`);
    } catch (e) {
      this.logger.error(`Kazi ya ankara ya kila mwezi imeshindwa: ${e}`);
    }
  }

  /** Kila siku saa 01:00: ankara zisizolipwa baada ya tarehe ya mwisho zinakuwa "expired". */
  @Cron('0 1 * * *', { timeZone: TZ })
  async expireOverdue() {
    try {
      await this.invoices.update(
        { status: In(['unpaid', 'partial']), dueDate: LessThan(todayTz()) },
        { status: 'expired' },
      );
    } catch (e) {
      this.logger.error(`expireOverdue imeshindwa: ${e}`);
    }
  }

  // ---------- Kupokea malipo ----------

  /** Saini ya webhook: HMAC-SHA256 ya mwili ghafi (raw body) kwa PAYMENT_WEBHOOK_SECRET. */
  verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    const secret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!secret || !rawBody || !signature) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const given = Buffer.from(signature.trim().toLowerCase());
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Inarekodi malipo. Ujumbe ule ule ukifika mara mbili unahesabiwa mara moja tu. */
  async recordPayment(p: WebhookPayload): Promise<{ ok: true; duplicate: boolean; status: string }> {
    if (
      !p ||
      typeof p.control_number !== 'string' ||
      typeof p.provider_ref !== 'string' ||
      !p.provider_ref ||
      !Number.isInteger(p.amount) ||
      p.amount <= 0
    ) {
      throw new AppError(400, 'INVALID_PAYLOAD', 'Taarifa za malipo si sahihi.');
    }
    const paidAt = p.paid_at ? new Date(p.paid_at) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      throw new AppError(400, 'INVALID_PAYLOAD', 'paid_at si sahihi.');
    }

    return this.ds.transaction(async (m) => {
      const invoice = await m.findOne(Invoice, {
        where: { controlNumber: p.control_number },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) {
        throw new AppError(404, 'INVOICE_NOT_FOUND', 'Control number haipatikani.');
      }

      if (await m.existsBy(Payment, { providerRef: p.provider_ref })) {
        return { ok: true as const, duplicate: true, status: invoice.status };
      }

      await m.save(
        Payment,
        m.create(Payment, {
          invoiceId: invoice.id,
          providerRef: p.provider_ref,
          amount: p.amount,
          paidAt,
          rawPayload: p as unknown as Record<string, unknown>,
        }),
      );

      const paidAmount = invoice.paidAmount + p.amount;
      const full = paidAmount >= invoice.amount;
      await m.update(Invoice, invoice.id, {
        paidAmount,
        status: full ? 'paid' : 'partial',
        paidAt: full ? paidAt : null,
      });
      return { ok: true as const, duplicate: false, status: full ? 'paid' : 'partial' };
    });
  }

  /** Kwa majaribio: admin anaiga malipo ya ankara (mock pekee). */
  async mockPay(invoiceId: string, amount?: number) {
    if (this.provider.name !== 'mock' || this.config.get<string>('NODE_ENV') === 'production') {
      throw new AppError(403, 'MOCK_DISABLED', 'Malipo ya kuigiza hayaruhusiwi hapa.');
    }
    const invoice = await this.invoices.findOneBy({ id: invoiceId });
    if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', 'Ankara haipatikani.');
    if (!invoice.controlNumber) {
      throw new AppError(409, 'NO_CONTROL_NUMBER', 'Ankara haina control number bado.');
    }
    return this.recordPayment({
      control_number: invoice.controlNumber,
      provider_ref: `mock-${randomUUID()}`,
      amount: amount ?? invoice.amount - invoice.paidAmount,
    });
  }
}
