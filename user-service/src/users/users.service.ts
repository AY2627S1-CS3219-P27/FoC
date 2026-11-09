import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  ArrayContains,
  DataSource,
  EntityManager,
  EntityNotFoundError,
  FindOptionsWhere,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { hashValue } from '../common/hash/hash.js';
import { User } from './user.entity.js';
import {
  UserUpdateAudit,
  UserUpdateAuditChangedField,
} from './user-update-audit.entity.js';
import {
  AccountEventContractValidator,
  MAX_PAGE_LIMIT,
  Role,
  USER_REGISTERED_V1_ROUTING_KEY,
  type UserRegisteredEvent,
} from '@foc/contracts';
import { OutboxEvent } from '@foc/outbox';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { OrderServiceClient } from '../order/order-service.client.js';

/** The PostgreSQL driver error code for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

/** The event publisher identity this service stamps on its outbox envelopes. */
const PUBLISHER = 'user-service';

const eventContractValidator = new AccountEventContractValidator();

/**
 * Consecutive failed-login attempts that lock an Active account.
 * Reaching this threshold transitions the account Active -> Locked.
 */
const MAX_FAILED_LOGIN_ATTEMPTS = 10;

/**
 * Generates a stable numeric key used based on account UUID.
 */
function accountLockKey(uuid: string): number {
  return Number.parseInt(
    createHash('md5').update(uuid).digest('hex').slice(0, 13),
    16,
  );
}

/** Set equality for role lists, which the set-replace path keeps canonical. */
function sameRoles(a: Role[], b: Role[]): boolean {
  return a.length === b.length && a.every((role) => b.includes(role));
}

/**
 * Advisory-lock key that serialises admin-privilege changes within the
 * user-service database. Arbitrary but fixed; the user-service owns its own
 * database, so it only has to be unique among the locks this service takes.
 */
const ADMIN_MUTATION_LOCK_KEY = 71_301_742_001;

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Email is already registered.');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

/** Raised when a constructed outbox envelope fails its own contract check. */
export class OutboxEnvelopeError extends Error {
  constructor() {
    super('Failed to construct a valid outbox envelope.');
    this.name = 'OutboxEnvelopeError';
  }
}

export interface ProvisionUserParams {
  email: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
  isLocked?: boolean;
}

export interface AdminCreateUserParams {
  email: string;
  displayName: string;
  roles?: Role[];
  profilePictureUrl?: string | null;
  isAdmin?: boolean;
}

export interface PublicUserInfo {
  uuid: string;
  email: string;
  displayName: string;
  profilePictureUrl: string | null;
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
    @InjectDataSource() private dataSource: DataSource,
    private authorizationService: AuthorizationService,
    private orderServiceClient: OrderServiceClient,
  ) {}

  async provisionUser({
    email,
    displayName,
    password,
    isAdmin = false,
    isLocked = false,
  }: ProvisionUserParams): Promise<PublicUserInfo> {
    const { passwordSalt, passwordHash } = await generatePasswordHash(password);
    const uuid = randomUUID();

    try {
      return await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);
        const user = await users.save(
          users.create({
            email,
            displayName,
            uuid,
            passwordHash,
            passwordSalt,
            isArchived: false,
            isAdmin,
            isLocked,
            roles: [],
          }),
        );

        const event = this.createUserRegisteredEvent(user);

        const outbox = manager.getRepository(OutboxEvent);
        await outbox.save(
          outbox.create({
            eventId: event.eventId,
            eventType: event.eventType,
            routingKey: USER_REGISTERED_V1_ROUTING_KEY,
            envelope: event,
            publishedAt: null,
            attemptCount: 0,
            lastError: null,
            claimedBy: null,
            claimedUntil: null,
          }),
        );

        return this.getPublicUserInfo(user);
      });
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

  private createUserRegisteredEvent(user: User): UserRegisteredEvent {
    const event: UserRegisteredEvent = {
      eventId: randomUUID(),
      eventType: 'UserRegistered',
      timestamp: new Date().toISOString(),
      publisher: PUBLISHER,
      payload: {
        userId: user.uuid,
        email: user.email,
        displayName: user.displayName,
      },
    };
    const validation = eventContractValidator.validate(
      USER_REGISTERED_V1_ROUTING_KEY,
      event,
    );
    if (!validation.valid) {
      throw new OutboxEnvelopeError();
    }

    return event;
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
      // Only Active accounts accrue failed attempts; a locked
      // or archived account is rejected without touching the counter.
      if (!user.isLocked && !user.isArchived) {
        await this.recordFailedLogin(user);
      }
      throw new UnauthorizedException();
    }

    if (user.isLocked || user.isArchived) {
      throw new UnauthorizedException();
    }

    // A successful verification clears the consecutive-failure counter.
    if (user.failedLoginAttempts !== 0) {
      user.failedLoginAttempts = 0;
      await this.userRepository.save(user);
    }

    return this.getPublicUserInfo(user);
  }

  /**
   * Records a failed-login attempt and, when the counter
   * reaches the threshold, locks the account.
   *
   * Runs in one transaction behind a per-account advisory lock so concurrent
   * attempts on the same account are serialised.
   */
  private async recordFailedLogin(user: User): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
        accountLockKey(user.uuid),
      ]);

      const current = await manager.findOneBy(User, { uuid: user.uuid });
      if (current === null || current.isLocked || current.isArchived) {
        return;
      }

      current.failedLoginAttempts += 1;
      if (current.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        current.isLocked = true;
      }
      await manager.save(current);
    });
  }

  /**
   * The authenticated user's persisted account state, or null when the
   * account no longer exists (e.g. pruned after the token was issued).
   */
  async getUserByUuid(uuid: string): Promise<PublicUserInfo | null> {
    const user = await this.userRepository.findOneBy({ uuid });
    return user === null ? null : this.getPublicUserInfo(user);
  }

  /** Same rule as login: a locked or archived account gets no new tokens. */
  async getActiveUserByUuid(uuid: string): Promise<PublicUserInfo | null> {
    const user = await this.userRepository.findOneBy({ uuid });
    return user === null || user.isLocked || user.isArchived
      ? null
      : this.getPublicUserInfo(user);
  }

  /**
   * Set-replaces the user's participant roles (M.1 F13.1.3). Duplicate or
   * out-of-order input is normalised to a set; the two participant roles are
   * the only possible values, so escalation to admin is impossible here.
   *
   * The acting user's access token is forwarded to order-service, which
   * enforces "admin or self" on the role-block endpoints.
   *
   * Runs in one transaction behind a per-account advisory lock, so the
   * in-use check, the block calls and the save all see one consistent role
   * set and a concurrent update cannot clobber this one.
   */
  async updateRoles(
    uuid: string,
    roles: Role[],
    accessToken: string,
  ): Promise<PublicUserInfo> {
    const saved = await this.dataSource.transaction(async (manager) => {
      // Serialise concurrent role updates for this account. Without it, two
      // requests can both read the same role set, each check/block a
      // different diff, and the last save silently wins — leaving a held role
      // blocked, or dropping a role without its in-use check.
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
        accountLockKey(uuid),
      ]);

      let user: User;
      try {
        user = await manager.findOneByOrFail(User, { uuid });
      } catch (error) {
        if (error instanceof EntityNotFoundError) {
          throw new UnauthorizedException();
        }
        throw error;
      }

      const roleList = Object.values(Role);
      // incoming role list doesn't have role that user has => role got removed
      const rolesToRemove: Role[] = roleList.filter(
        (role) => user.roles.includes(role) && !roles.includes(role),
      );
      // conversely, incoming role list has role that user doesn't have => role got added
      const rolesToAdd: Role[] = roleList.filter(
        (role) => !user.roles.includes(role) && roles.includes(role),
      );

      let removalBlockPlaced = false;
      try {
        await this.tryRemoveRoles(user, rolesToRemove, accessToken);
        removalBlockPlaced = rolesToRemove.length > 0;
        await this.addRoles(user, rolesToAdd, accessToken);

        // Set-replace: the stored roles are exactly the requested set, in the
        // enum's canonical order, so duplicate and out-of-order input never
        // survives. The order-service calls above only gate the change.
        user.roles = roleList.filter((role) => roles.includes(role));

        await manager.save(user);
      } catch (error) {
        // A block was placed for the roles leaving the account, but the change
        // did not commit (a failed save, a rejected re-addition unblock, ...).
        // Lift it, or the kept role stays unusable until the block TTL expires.
        // Best effort: a missed compensation still expires on its own.
        if (removalBlockPlaced) {
          await this.orderServiceClient.unblockRoles(
            user.uuid,
            rolesToRemove,
            accessToken,
          );
        }
        throw error;
      }

      return user;
    });

    return this.getPublicUserInfo(saved);
  }

  /**
   * Asks order-service to check and block the roles about to leave the
   * account (F10). All or nothing: order-service blocks none of the roles
   * when any one is in use, and a 409 aborts the whole change.
   *
   * The block also stops a device holding a stale access token from starting
   * new work in the removed role until its token refreshes.
   */
  private async tryRemoveRoles(
    user: User,
    roles: Role[],
    accessToken: string,
  ): Promise<void> {
    if (roles.length === 0) {
      return;
    }

    const canRemove = await this.orderServiceClient.blockRoles(
      user.uuid,
      roles,
      accessToken,
    );
    if (!canRemove) {
      throw new ConflictException(
        'Role cannot be removed while the account has active items related to the role.',
      );
    }
  }

  /**
   * Lifts any block still in place on the roles about to be added, so a
   * re-added role is usable immediately.
   *
   * The unblock must succeed: order-service refuses work in a blocked role,
   * so a silent failure would return 200 for a role the user cannot actually
   * use until the block TTL expires. It runs before the roles are saved, so
   * throwing here leaves nothing persisted and the user's retry re-attempts
   * the unblock cleanly.
   */
  private async addRoles(
    user: User,
    roles: Role[],
    accessToken: string,
  ): Promise<void> {
    if (roles.length === 0) {
      return;
    }

    const unblocked = await this.orderServiceClient.unblockRoles(
      user.uuid,
      roles,
      accessToken,
    );
    if (!unblocked) {
      throw new BadGatewayException(
        'order-service could not lift the block on the added roles',
      );
    }
  }

  /**
   * Updates the authenticated user's particulars. Only the fields
   * present in the request are written; an explicit `null`
   * profilePictureUrl clears/keeps the picture respectively. Returns the
   * updated public profile.
   */
  async updateProfile(
    uuid: string,
    fields: { displayName?: string; profilePictureUrl?: string | null },
  ): Promise<PublicUserInfo> {
    let user: User;
    try {
      user = await this.userRepository.findOneByOrFail({ uuid });
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw new UnauthorizedException();
      }
      throw error;
    }

    if (fields.displayName !== undefined) {
      user.displayName = fields.displayName;
    }
    if (fields.profilePictureUrl !== undefined) {
      user.profilePictureUrl = fields.profilePictureUrl;
    }

    const saved = await this.userRepository.save(user);
    return this.getPublicUserInfo(saved);
  }

  /**
   * Applies an admin-initiated update to a target account.
   *
   * Runs in one transaction so the audit entry is written if and
   * only if the change commits. The acting admin is re-read from the database
   * rather than trusted from the token claims.
   *
   * The transaction first takes a transaction-scoped advisory lock.
   *
   * Archiving asks order-service to block every role the target still holds
   * (and un-archiving lifts that block), so a stale access token cannot keep
   * starting errands in an archived account.
   */
  async adminUpdateUser(
    actorUuid: string,
    targetUuid: string,
    fields: { isAdmin?: boolean; isArchived?: boolean },
    accessToken: string,
  ): Promise<User> {
    // Read the roles outside the transaction: order-service may take up to
    // its client timeout to answer, and the advisory lock must not be held
    // across network I/O. The transaction re-reads the row and stays
    // authoritative for the change itself.
    const existing = await this.userRepository.findOneBy({ uuid: targetUuid });
    const archiving =
      existing != null && fields.isArchived === true && !existing.isArchived;
    const expectedRoles = existing?.roles ?? [];
    let blockedRoles: Role[] = [];
    if (existing != null && archiving && expectedRoles.length > 0) {
      await this.blockErrands(existing, accessToken);
      blockedRoles = expectedRoles;
    }

    let demoted;
    let unarchived = false;
    let target: User;
    try {
      target = await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
          ADMIN_MUTATION_LOCK_KEY,
        ]);
        // Order: admin lock, then the account lock shared with updateRoles,
        // so an archive cannot interleave with a concurrent role change.
        await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
          accountLockKey(targetUuid),
        ]);

        await this.checkIsAdmin(manager, actorUuid);

        const target = await manager.findOneBy(User, { uuid: targetUuid });
        if (target === null) {
          throw new NotFoundException('User not found');
        }

        // The block above covers the roles read before the transaction. If
        // they moved since, archiving would leave a held role unblocked.
        if (archiving && !sameRoles(expectedRoles, target.roles)) {
          throw new ConflictException(
            'Account roles changed concurrently; retry the archive.',
          );
        }

        // Audit record of changes
        const changedFields: Record<string, UserUpdateAuditChangedField> = {};

        // Perform admin status change
        const { change: adminChange, isDemoted } =
          await this.applyAdminStatusChange(manager, target, fields.isAdmin);
        if (adminChange !== undefined) changedFields.isAdmin = adminChange;
        demoted = isDemoted; // update upper-scope demoted variable for post-transaction actions

        // Perform archive status change
        const archiveChange = await this.applyArchiveChange(
          manager,
          target,
          fields.isArchived,
        );
        if (archiveChange !== undefined) {
          changedFields.isArchived = archiveChange;
          unarchived = !archiveChange.to;
        }

        // No change; return early without saving
        if (Object.keys(changedFields).length === 0) {
          return target;
        }

        await manager.save(target);
        await manager.save(
          manager.create(UserUpdateAudit, {
            actorUuid,
            targetUuid,
            changedFields,
          }),
        );

        return target;
      });
    } catch (error) {
      // The archive never committed, so lift the block placed above; the
      // account keeps its roles and must stay usable. Best effort: a missed
      // unblock expires on its own.
      if (blockedRoles.length > 0) {
        await this.orderServiceClient.unblockRoles(
          targetUuid,
          blockedRoles,
          accessToken,
        );
      }
      throw error;
    }

    // Post-transaction: create/remove admin block (redis)
    if (demoted === true) {
      await this.authorizationService.createAdminBlock(targetUuid);
    } else if (demoted === false) {
      await this.authorizationService.removeAdminBlock(targetUuid);
    }

    // Post-transaction: lift the order-service block once the un-archive has
    // committed, so the restored account is usable immediately. Best effort,
    // like a role re-addition: a missed unblock expires with the block TTL.
    if (unarchived && target.roles.length > 0) {
      await this.orderServiceClient.unblockRoles(
        targetUuid,
        target.roles,
        accessToken,
      );
    }

    return target;
  }

  /**
   * Archives the caller's own account
   *
   * Self-initiated, so no audit entry is written. Before the archive commits,
   * order-service checks the account's roles for ongoing errands and blocks
   * them, so a stale access token cannot keep starting work in the archived
   * account.
   */
  async archiveSelf(uuid: string, accessToken: string): Promise<User> {
    // Read the roles outside the transaction: the order-service call can take
    // up to the client's timeout, and the advisory lock must not be held
    // across network I/O.
    const existing = await this.userRepository.findOneBy({ uuid });
    const archiving = existing != null && !existing.isArchived;
    const expectedRoles = existing?.roles ?? [];
    let blockedRoles: Role[] = [];
    if (existing != null && archiving && expectedRoles.length > 0) {
      await this.blockErrands(existing, accessToken);
      blockedRoles = expectedRoles;
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
          ADMIN_MUTATION_LOCK_KEY,
        ]);
        // Order: admin lock, then the account lock shared with updateRoles,
        // so an archive cannot interleave with a concurrent role change.
        await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
          accountLockKey(uuid),
        ]);

        const user = await manager.findOneBy(User, { uuid });
        if (user === null) {
          throw new UnauthorizedException();
        }

        // The block above covers the roles read before the transaction. If
        // they moved since, archiving would leave a held role unblocked.
        if (archiving && !sameRoles(expectedRoles, user.roles)) {
          throw new ConflictException(
            'Account roles changed concurrently; retry the archive.',
          );
        }

        const archiveChange = await this.applyArchiveChange(
          manager,
          user,
          true,
        );
        if (archiveChange === undefined) {
          return user;
        }

        await manager.save(user);
        return user;
      });
    } catch (error) {
      // The archive never committed, so lift the block placed above; the
      // account keeps its roles and must stay usable. Best effort: a missed
      // unblock expires on its own.
      if (blockedRoles.length > 0) {
        await this.orderServiceClient.unblockRoles(
          uuid,
          blockedRoles,
          accessToken,
        );
      }
      throw error;
    }
  }

  /**
   * Applies an admin-status change to the target row, returning the audit
   * entry when the value actually changed (and `undefined` otherwise).
   */
  private async applyAdminStatusChange(
    manager: EntityManager,
    target: User,
    isAdmin: boolean | undefined,
  ): Promise<{
    change: UserUpdateAuditChangedField | undefined;
    isDemoted: boolean | undefined;
  }> {
    let isDemoted;
    if (isAdmin === undefined || isAdmin === target.isAdmin) {
      return { change: undefined, isDemoted };
    }

    const oldAdminStatus = target.isAdmin;

    if (!isAdmin) {
      await this.demoteAdmin(manager, target);
      isDemoted = true;
    } else {
      target.isAdmin = true; // no other checks needed for promotion
      isDemoted = false;
    }

    const change: UserUpdateAuditChangedField = {
      from: oldAdminStatus,
      to: isAdmin,
    };
    return { change, isDemoted };
  }

  private async checkIsAdmin(manager: EntityManager, actorUuid: string) {
    const actor = await manager.findOneBy(User, { uuid: actorUuid });
    if (
      actor === null ||
      !actor.isAdmin ||
      actor.isLocked ||
      actor.isArchived
    ) {
      throw new ForbiddenException('Admin privileges required');
    }
  }

  private async demoteAdmin(
    manager: EntityManager,
    target: User,
  ): Promise<void> {
    // Demoting an admin must leave at least one active admin; locked
    // admins still count, mirroring countActiveAdmins.
    // We don't need to do further checks if user is already archived;
    // their count doesn't matter.
    if (await this.isFinalActiveAdmin(manager, target)) {
      throw new ConflictException(
        'Cannot demote the last active admin account',
      );
    }

    target.isAdmin = false;
  }

  /**
   * Checks if the provided user is the final non-archived admin in the
   * application.
   */
  private async isFinalActiveAdmin(
    manager: EntityManager,
    target: User,
  ): Promise<boolean> {
    const otherAdminsCount = await manager.count(User, {
      where: { isAdmin: true, isArchived: false, uuid: Not(target.uuid) },
    });
    if (target.isAdmin && !target.isArchived && otherAdminsCount == 0) {
      return true;
    }
    return false;
  }

  /**
   * Applies an archival-status change to the target row, returning the audit
   * entry when the value actually changed (and `undefined` otherwise).
   *
   * The order-service block that guards the transition is not handled here:
   * callers do it outside the transaction, before archiving or after
   * un-archiving commits.
   */
  private async applyArchiveChange(
    manager: EntityManager,
    target: User,
    isArchived: boolean | undefined,
  ): Promise<UserUpdateAuditChangedField | undefined> {
    if (isArchived === undefined || isArchived === target.isArchived) {
      return undefined;
    }

    if (isArchived) {
      if (await this.isFinalActiveAdmin(manager, target)) {
        throw new ConflictException(
          'Cannot archive the last remaining active admin.',
        );
      }
      // TODO: revoke every refresh token tied to this account.
    }

    const change = { from: target.isArchived, to: isArchived };
    target.isArchived = isArchived;
    return change;
  }

  /**
   * Asks order-service to check every role the account still holds for
   * ongoing errands and block them, so a stale access token cannot keep
   * starting work while the account is archived.
   *
   * A `409` (`ROLE_IN_USE`) aborts the archive; a gateway failure propagates
   * because whether archiving is safe is unknown.
   */
  private async blockErrands(user: User, accessToken: string): Promise<void> {
    if (user.roles.length === 0) {
      return;
    }

    const canArchive = await this.orderServiceClient.blockRoles(
      user.uuid,
      user.roles,
      accessToken,
    );
    if (!canArchive) {
      throw new ConflictException(
        'Account cannot be archived while it has active errands.',
      );
    }
  }

  /**
   * Creates a new user on behalf of an acting admin
   *
   * The account is provisioned locked with a random discarded
   * password.
   */
  async adminCreateUser(
    actorUuid: string,
    fields: AdminCreateUserParams,
  ): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [
        ADMIN_MUTATION_LOCK_KEY,
      ]);

      await this.checkIsAdmin(manager, actorUuid);

      // Random password with the plaintext discarded immediately after
      // hashing. Will be set by the user through the reset flow.
      const password = randomBytes(32).toString('base64url');
      const { passwordSalt, passwordHash } =
        await generatePasswordHash(password);

      const user = manager.create(User, {
        email: fields.email,
        displayName: fields.displayName,
        uuid: randomUUID(),
        passwordHash,
        passwordSalt,
        isArchived: false,
        isAdmin: fields.isAdmin ?? false,
        isLocked: true,
        roles: [...new Set(fields.roles ?? [])],
        profilePictureUrl: fields.profilePictureUrl ?? null,
      });

      try {
        await manager.save(user);
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error.driverError as { code?: string } | null)?.code ===
            UNIQUE_VIOLATION_CODE
        ) {
          throw new ConflictException('Email is already registered.');
        }
        throw error;
      }

      // Audit record of the insert: every field set is recorded as a
      // from-null change. Credentials are never audited.
      const changedFields: Record<string, UserUpdateAuditChangedField> = {
        email: { from: null, to: fields.email },
        displayName: { from: null, to: fields.displayName },
        roles: { from: null, to: user.roles },
        isAdmin: { from: null, to: user.isAdmin },
        isLocked: { from: null, to: true },
        isArchived: { from: null, to: false },
      };
      if (fields.profilePictureUrl !== undefined) {
        changedFields.profilePictureUrl = {
          from: null,
          to: fields.profilePictureUrl,
        };
      }

      await manager.save(
        manager.create(UserUpdateAudit, {
          actorUuid,
          targetUuid: user.uuid,
          changedFields,
        }),
      );

      return user;
    });
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
  async updatePassword(uuid: string, password: string): Promise<void> {
    let user: User;
    try {
      user = await this.userRepository.findOneByOrFail({ uuid });
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
    user.failedLoginAttempts = 0;
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
      order: { uuid: 'ASC' },
    });

    return { users, total, offset: safeOffset, limit: safeLimit };
  }

  /**
   * Info of a user safe to be received by end-users.
   */
  private getPublicUserInfo(user: User): PublicUserInfo {
    return {
      uuid: user.uuid,
      email: user.email,
      displayName: user.displayName,
      profilePictureUrl: user.profilePictureUrl ?? null,
      roles: user.roles ?? [],
      isAdmin: user.isAdmin,
    };
  }
}
