import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'TOO_MANY_REQUESTS',
};

/** Kila kosa linarudi katika muundo mmoja: { error: { code, message } } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Hitilafu ya server. Jaribu tena baadaye.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (body && typeof body === 'object' && body.code) {
        code = body.code;
        message = body.message;
      } else if (body && Array.isArray(body.message)) {
        code = 'VALIDATION_ERROR';
        message = body.message.join('; ');
      } else {
        code = STATUS_CODES[status] ?? 'ERROR';
        message =
          typeof body === 'string' ? body : (body?.message ?? exception.message);
      }
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({ error: { code, message } });
  }
}
