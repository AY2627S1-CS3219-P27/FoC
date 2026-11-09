import type { AuthenticatedRequest } from '@foc/auth';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { auditContext } from './audit-context.js';

/**
 * Makes the acting user available to every service call of a request, for
 * the audit log (F14.4). The user is the verified token's `sub` (F13.1),
 * never anything from the body. Guards run before interceptors, so by now an
 * unauthenticated request has already been refused; an open route such as
 * /health has no user and records nothing anyway.
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    const sub = request.user?.sub;
    if (sub === undefined) {
      return next.handle();
    }
    const actorId = sub.toLowerCase();
    // The handler runs on subscription, so the context must wrap that.
    return new Observable((subscriber) =>
      auditContext.run({ actorId }, () => next.handle().subscribe(subscriber)),
    );
  }
}
