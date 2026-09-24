import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  EmailAlreadyRegisteredError,
  UsersService,
} from '../users/users.service.js';

/**
 * Hook into NestJS's OnApplicationBootstrap lifecycle stage to create
 * an admin user if there are none active.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const adminCount = await this.usersService.countActiveAdmins();

    if (adminCount > 0) {
      this.logger.debug(
        `Skipping admin bootstrap: ${adminCount} unarchived admin account(s) present.`,
      );
      return;
    }

    const email = this.configService.get<string>('ADMIN_BOOTSTRAP_EMAIL');
    const displayName = this.configService.get<string>(
      'ADMIN_BOOTSTRAP_DISPLAY_NAME',
    );

    // Admin bootstrap is optional - missing envvar does not crash the application.
    if (!email || !displayName) {
      this.logger.warn(
        'No admin accounts present and ADMIN_BOOTSTRAP_EMAIL/ADMIN_BOOTSTRAP_DISPLAY_NAME is not set; skipping admin bootstrap.',
      );
      return;
    }

    // Random password with the plaintext discarded immediately after hashing.
    // Will be set by user through reset flow.
    const password = randomBytes(32).toString('base64url');

    try {
      await this.usersService.provisionUser({
        email,
        displayName,
        password,
        isAdmin: true,
        isLocked: true,
      });
      this.logger.log(`Provisioned bootstrap admin account for ${email}.`);
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        // Insert failed - coerce a helpful log message so state is clear to ops.
        let adminCount: number;
        try {
          adminCount = await this.usersService.countActiveAdmins();
        } catch (countError) {
          this.logger.error(
            `Failed to confirm admin presence after a bootstrap email conflict: ${
              countError instanceof Error
                ? countError.message
                : String(countError)
            }`,
          );
          return;
        }
        if (adminCount > 0) {
          this.logger.log(
            'Bootstrap admin already provisioned (concurrent bootstrap); continuing.',
          );
          return;
        }
        this.logger.error(
          `Bootstrap admin email ${email} belongs to an existing non-admin user; no admin account was created.`,
        );
        return;
      }

      this.logger.error(
        `Failed to provision bootstrap admin account: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
