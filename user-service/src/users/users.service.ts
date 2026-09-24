import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { QueryFailedError, Repository } from 'typeorm';
import { hashValue } from '../common/hash/hash.js';
import { User } from './user.entity.js';

/** The PostgreSQL driver error code for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Email is already registered.');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

export interface ProvisionUserParams {
  email: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
  isLocked?: boolean;
}

export interface ProvisionedUser {
  id: number;
  email: string;
  displayName: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private userRepository: Repository<User>,
  ) {}

  async provisionUser({
    email,
    displayName,
    password,
    isAdmin = false,
    isLocked = false,
  }: ProvisionUserParams): Promise<ProvisionedUser> {
    // Fresh per-account salt, stored next to the hash so the credentials can
    // be re-verified later without derivable state.
    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = await hashValue(password, passwordSalt);

    try {
      const user = await this.userRepository.save(
        this.userRepository.create({
          email,
          displayName,
          passwordHash,
          passwordSalt,
          isActive: true,
          isArchived: false,
          isAdmin,
          isLocked,
        }),
      );

      // Expose only the identifying fields
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      };
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | null)?.code ===
          UNIQUE_VIOLATION_CODE
      ) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  /**
   * Counts the admin accounts that are not archived. Locked admins still
   * count.
   */
  async countActiveAdmins(): Promise<number> {
    return this.userRepository.count({
      where: { isAdmin: true, isArchived: false },
    });
  }
}
