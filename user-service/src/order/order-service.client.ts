import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Role } from '@foc/contracts';

/**
 * A role-block call runs synchronously inside a user request, so it must not
 * hang indefinitely on a slow or unreachable order-service.
 */
const ORDER_SERVICE_TIMEOUT_MS = 5_000;

/** The body both order-service role-block endpoints take. */
interface RoleBlockBody {
  userId: string;
  roles: Role[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Client for order-service's role-block endpoints
 *
 * User-service calls this before removing a role (or
 * archiving an account) so a stale access token cannot keep starting work in
 * it. Every call forwards the acting user's (or admin's) access token:
 * order-service verifies it with user-service's public key and enforces
 * "admin or self".
 */
@Injectable()
export class OrderServiceClient {
  private readonly logger = new Logger(OrderServiceClient.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Checks every named role has no ongoing errands and blocks it until the
   * block TTL expires. All or nothing: order-service blocks none of them when
   * any role is in use.
   *
   * Returns `true` when all roles are blocked (the caller may continue with
   * the role change) and `false` when at least one is still in use
   * (`409 ROLE_IN_USE`). Every other outcome is a gateway failure and is
   * thrown, since whether the change may proceed is unknown.
   */
  async blockRoles(
    userId: string,
    roles: Role[],
    accessToken: string,
  ): Promise<boolean> {
    let response: Response;
    try {
      response = await this.send('POST', { userId, roles }, accessToken);
    } catch (error) {
      this.logger.error(
        `Could not reach order-service to block roles for ${userId}: ${errorMessage(error)}`,
      );
      throw new BadGatewayException('order-service is unreachable');
    }

    if (response.ok) {
      return true;
    }
    if (response.status === 409) {
      return false;
    }

    this.logger.error(
      `order-service rejected the role block for ${userId} with status ${response.status}`,
    );
    throw new BadGatewayException('order-service rejected the role block');
  }

  /**
   * Removes any block on the named roles early: on a role re-addition, or
   * when the role change it was placed for failed.
   *
   * Best effort by design. A missed unblock only lasts the block TTL (the
   * access-token lifetime plus skew), while surfacing the error would fail a
   * role addition that is otherwise valid, so failures are logged instead.
   */
  async unblockRoles(
    userId: string,
    roles: Role[],
    accessToken: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.send('DELETE', { userId, roles }, accessToken);
    } catch (error) {
      this.logger.warn(
        `Could not reach order-service to unblock roles for ${userId}: ${errorMessage(error)}. The block will expire on its own.`,
      );
      return;
    }

    if (!response.ok) {
      this.logger.warn(
        `order-service rejected the unblock for ${userId} with status ${response.status}. The block will expire on its own.`,
      );
    }
  }

  private async send(
    method: 'POST' | 'DELETE',
    body: RoleBlockBody,
    accessToken: string,
  ): Promise<Response> {
    const baseUrl = this.configService
      .getOrThrow<string>('ORDER_SERVICE_BASE_URL')
      .replace(/\/+$/, '');

    return fetch(`${baseUrl}/v1/role-blocks`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ORDER_SERVICE_TIMEOUT_MS),
    });
  }
}
