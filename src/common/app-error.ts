import { HttpException } from '@nestjs/common';

/** Kosa lenye msimbo (code) unaorudishwa kwa app: { error: { code, message } } */
export class AppError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}
