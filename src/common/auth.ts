import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppError } from './app-error';

/**
 * Majukumu ya token:
 *  passenger = abiria (kifaa), owner = mmiliki, driver = dereva,
 *  admin = administrator, new = namba imethibitishwa lakini bado haijasajiliwa.
 */
export type Role = 'passenger' | 'owner' | 'driver' | 'admin' | 'new';

export interface AuthUser {
  sub: string;
  role: Role;
  phone?: string;
  adminRole?: string;
}

export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);

/** Guard ya kimataifa: kila endpoint inahitaji token isipokuwa ikiwa na @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('isPublic', targets)) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new AppError(401, 'UNAUTHORIZED', 'Hujaingia. Token inahitajika.');
    }

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new AppError(401, 'TOKEN_INVALID', 'Token si sahihi au imeisha muda.');
    }
    if (!payload.role || !payload.sub) {
      throw new AppError(401, 'TOKEN_INVALID', 'Token si sahihi.');
    }
    req.user = payload;

    const roles = this.reflector.getAllAndOverride<Role[]>('roles', targets);
    if (roles && roles.length > 0 && !roles.includes(payload.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Huna ruhusa ya kufanya hili.');
    }
    return true;
  }
}
