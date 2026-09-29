import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ArrayContains,
  EntityNotFoundError,
  FindOptionsWhere,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { hashValue } from '../common/hash/hash.js';
import { User } from './user.entity.js';
import { MAX_PAGE_LIMIT, Role } from '@foc/contracts';

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

export interface PublicUserInfo {
  id: number;
  email: string;
  displayName: string;
  roles: Role[];
  isAdmin: boolean;
}

/**
 * Filters and pagination for listing users.
 **/
export interface ListUsersQuery {
  role?: Role;
  isAdmin?: boolean;
  isLocked?: boolean;
  isArchived?: boolean;
  /** Zero-based offset into the full result set */
  offset: number;
  /** Maximum rows to return */
  limit: number;
}

export interface UserListResult {
  users: User[];
  /** Count of records matching the filters across all pages (N3.1.3). */
  total: number;
  /** The offset actually applied, after clamping. */
  offset: number;
  /** The limit actually applied, after clamping. */
  limit: number;
}

async function generatePasswordHash(password: string) {
  const passwordSalt = randomBytes(16).toString('hex');
  const passwordHash = await hashValue(password, passwordSalt);
  return {
    passwordSalt,
    passwordHash,
  };
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
  }: ProvisionUserParams): Promise<PublicUserInfo> {
    const { passwordSalt, passwordHash } = await generatePasswordHash(password);

    try {
      const user = await this.userRepository.save(
        this.userRepository.create({
          email,
          displayName,
          passwordHash,
          passwordSalt,
          isArchived: false,
          isAdmin,
          isLocked,
          roles: [],
        }),
      );

      return this.getPublicUserInfo(user);
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
   * Checks a provided (email, password) pair against the stored credentials
   * and returns the user's public info on success.
   *
   * Throws `UnauthorizedException` for known failed conditions alike (unknown
   * email, wrong password, or unusable account)
   */
  async checkUserAndReturnInfo(email: string, password: string) {
    let user: User;
    try {
      user = await this.userRepository.findOneByOrFail({ email });
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw new UnauthorizedException();
      }
      throw error;
    }

    // Re-hash the supplied password with the stored salt and compare.
    const userPasswordHashed = Buffer.from(user.passwordHash, 'hex');
    const suppliedPasswordHashed = Buffer.from(
      await hashValue(password, user.passwordSalt),
      'hex',
    );
    const passwordsMatch =
      userPasswordHashed.length === suppliedPasswordHashed.length &&
      timingSafeEqual(userPasswordHashed, suppliedPasswordHashed);

    if (!passwordsMatch) {
      throw new UnauthorizedException();
    }

    if (user.isLocked || user.isArchived) {
      throw new UnauthorizedException();
    }

    return this.getPublicUserInfo(user);
  }

  /**
   * The authenticated user's persisted account state, or null when the
   * account no longer exists (e.g. pruned after the token was issued).
   */
  async getUserById(id: number): Promise<PublicUserInfo | null> {
    const user = await this.userRepository.findOneBy({ id });
    return user === null ? null : this.getPublicUserInfo(user);
  }

  /**
   * Set-replaces the user's participant roles (M.1 F13.1.3). Duplicate or
   * out-of-order input is normalised to a set; the two participant roles are
   * the only possible values, so escalation to admin is impossible here.
   */
  async updateRoles(id: number, roles: Role[]): Promise<PublicUserInfo> {
    let user: User;
    try {
      user = await this.userRepository.findOneByOrFail({ id });
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw new UnauthorizedException();
      }
      throw error;
    }

    // Convert to set-and-back to deduplicate
    user.roles = [...new Set(roles)];
    const saved = await this.userRepository.save(user);
    return this.getPublicUserInfo(saved);
  }

  /**
   * Whether any account — archived or locked included — is tied to the given
   * email.
   */
  async existsByEmail(email: string): Promise<boolean> {
    return this.userRepository.exists({ where: { email } });
  }

  /**
   * Finds an **un-archived** user by email
   */
  async findActiveUserByEmail(email: string): Promise<PublicUserInfo | null> {
    const user = await this.userRepository.findOneBy({
      email,
      isArchived: false,
    });
    return user === null ? null : this.getPublicUserInfo(user);
  }

  /**
   * Re-hashes and stores a new password with a fresh per-account salt, using
   * the same mechanism as provisioning.
   *
   * Additionally clears lock on the associated user
   */
  async updatePassword(userId: number, password: string): Promise<void> {
    let user: User;
    try {
      user = await this.userRepository.findOneByOrFail({ id: userId });
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw new UnauthorizedException();
      }
      throw error;
    }

    const { passwordSalt, passwordHash } = await generatePasswordHash(password);
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.isLocked = false;
    await this.userRepository.save(user);
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

  /**
   * Lists users matching the authorised filters, one page at a time.
   */
  async listUsers({
    role,
    isAdmin,
    isLocked,
    isArchived,
    offset,
    limit,
  }: ListUsersQuery): Promise<UserListResult> {
    // Ensure offset is an integer value
    const safeOffset = Math.max(0, Math.trunc(offset));
    const safeLimit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(limit)));

    const where: FindOptionsWhere<User> = {};
    if (role !== undefined) {
      // Postgres enum-array containment: rows whose roles include `role`.
      where.roles = ArrayContains([role]);
    }
    if (isAdmin !== undefined) where.isAdmin = isAdmin;
    if (isLocked !== undefined) where.isLocked = isLocked;
    if (isArchived !== undefined) where.isArchived = isArchived;

    const [users, total] = await this.userRepository.findAndCount({
      where,
      skip: safeOffset,
      take: safeLimit,
      order: { id: 'ASC' },
    });

    return { users, total, offset: safeOffset, limit: safeLimit };
  }

  /**
   * Info of a user safe to be received by end-users.
   */
  private getPublicUserInfo(user: User): PublicUserInfo {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles ?? [],
      isAdmin: user.isAdmin,
    };
  }
}
