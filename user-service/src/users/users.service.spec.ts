import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ArrayContains,
  DataSource,
  EntityNotFoundError,
  QueryFailedError,
} from 'typeorm';
import { hashValue } from '../common/hash/hash.js';
import { Role, USER_REGISTERED_V1_ROUTING_KEY } from '@foc/contracts';
import { OutboxEvent } from '@foc/outbox';
import { User } from './user.entity.js';
import { UserUpdateAudit } from './user-update-audit.entity.js';
import { EmailAlreadyRegisteredError, UsersService } from './users.service.js';
import { AuthorizationService } from '../authorization/authorization.service.js';

vi.mock('../common/hash/hash.js', () => ({
  hashValue: vi.fn(async () => 'ab'.repeat(64)),
}));

/** Canonical lowercase v4 UUID, as produced by node:crypto randomUUID. */
// Obtained from: https://stackoverflow.com/a/13653180
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Fixed v4 UUID standing in for a stored row's primary identity. */
const FIXED_UUID = '11111111-1111-4111-8111-111111111111';

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>;
  };
  let manager: {
    query: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    getRepository: ReturnType<typeof vi.fn>;
  };
  let userRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let outboxRepo: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let dataSource: { transaction: ReturnType<typeof vi.fn> };
  let authorizationService: {
    createAdminBlock: ReturnType<typeof vi.fn>;
    removeAdminBlock: ReturnType<typeof vi.fn>;
    checkIsAdminBlocked: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    userRepository = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ ...data })),
      count: vi.fn(async () => 0),
      findOneBy: vi.fn(),
      findOneByOrFail: vi.fn(),
      exists: vi.fn(async () => false),
      findAndCount: vi.fn(),
    };
    userRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ ...data })),
    };
    outboxRepo = {
      create: vi.fn((data) => data),
      save: vi.fn(async (data) => ({ ...data })),
    };
    manager = {
      query: vi.fn(async () => undefined),
      findOneBy: vi.fn(),
      count: vi.fn(),
      save: vi.fn(async (_entity, data) => data),
      create: vi.fn((_entity, data) => data),
      getRepository: vi.fn((entity: unknown) =>
        entity === User ? userRepo : outboxRepo,
      ),
    };
    dataSource = {
      transaction: vi.fn(
        async (callback: (m: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    };

    authorizationService = {
      createAdminBlock: vi.fn(async () => undefined),
      removeAdminBlock: vi.fn(async () => undefined),
      checkIsAdminBlocked: vi.fn(async () => false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: DataSource, useValue: dataSource },
        { provide: AuthorizationService, useValue: authorizationService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);

    // The hashing helper is module-mocked; clear call history between tests
    // so call-count assertions only see the test under execution.
    vi.mocked(hashValue).mockClear();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('provisions a regular user active, unarchived and plain-flagged', async () => {
    const user = await service.provisionUser({
      email: 'eve@example.com',
      displayName: 'Eve',
      password: 'StrongPassw0rd!',
    });

    // Same contract the registration flow relied on: a fresh
    // per-user salt, argon2id digest, active account — plus the new flags
    // defaulting to false and no participant roles until the user opts in.
    expect(userRepo.save).toHaveBeenCalledWith({
      email: 'eve@example.com',
      displayName: 'Eve',
      uuid: expect.stringMatching(UUID_PATTERN),
      passwordHash: 'ab'.repeat(64),
      passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
      isArchived: false,
      isAdmin: false,
      isLocked: false,
      roles: [],
    });

    // Response exposes the public profile: identifying fields, the role set
    // (empty until opt-in) and the admin classification — never credentials.
    expect(user).toEqual({
      uuid: expect.stringMatching(UUID_PATTERN),
      email: 'eve@example.com',
      displayName: 'Eve',
      profilePictureUrl: null,
      roles: [],
      isAdmin: false,
    });
  });

  it('writes a user-registered outbox envelope alongside the account', async () => {
    await service.provisionUser({
      email: 'eve@example.com',
      displayName: 'Eve',
      password: 'StrongPassw0rd!',
    });

    expect(manager.getRepository).toHaveBeenCalledWith(OutboxEvent);
    expect(outboxRepo.save).toHaveBeenCalledTimes(1);

    const outboxRow = outboxRepo.save.mock.calls[0][0];
    expect(outboxRow).toMatchObject({
      eventId: expect.stringMatching(UUID_PATTERN),
      eventType: 'UserRegistered',
      routingKey: USER_REGISTERED_V1_ROUTING_KEY,
      publishedAt: null,
      attemptCount: 0,
      lastError: null,
      claimedBy: null,
      claimedUntil: null,
    });
    expect(outboxRow.envelope).toMatchObject({
      eventId: outboxRow.eventId,
      eventType: 'UserRegistered',
      timestamp: expect.stringMatching(/Z$/),
      publisher: 'user-service',
      payload: {
        userId: expect.stringMatching(UUID_PATTERN),
        email: 'eve@example.com',
        displayName: 'Eve',
      },
    });

    // The account write and its outbox envelope commit in the same
    // transaction, so they cannot diverge.
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('provisions an admin account locked on request', async () => {
    await service.provisionUser({
      email: 'root@example.com',
      displayName: 'Root',
      password: 'discarded',
      isAdmin: true,
      isLocked: true,
    });

    expect(userRepo.save).toHaveBeenCalledWith({
      email: 'root@example.com',
      displayName: 'Root',
      uuid: expect.stringMatching(UUID_PATTERN),
      passwordHash: 'ab'.repeat(64),
      passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
      isArchived: false,
      isAdmin: true,
      isLocked: true,
      roles: [],
    });
  });

  it('hashes the password with a fresh salt per provisioning', async () => {
    await service.provisionUser({
      email: 'a@example.com',
      displayName: 'A',
      password: 'pw-a',
    });
    await service.provisionUser({
      email: 'b@example.com',
      displayName: 'B',
      password: 'pw-b',
    });

    const salts = vi.mocked(hashValue).mock.calls.map((call) => call[1]);
    expect(salts).toHaveLength(2);
    expect(salts[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(salts[0]).not.toBe(salts[1]);
  });

  it('throws EmailAlreadyRegisteredError on a unique violation', async () => {
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    userRepo.save.mockRejectedValue(
      new QueryFailedError('INSERT INTO users', [], driverError),
    );

    await expect(
      service.provisionUser({
        email: 'eve@example.com',
        displayName: 'Eve',
        password: 'StrongPassw0rd!',
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('writes no outbox envelope when the account insert is rejected', async () => {
    const driverError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
    });
    userRepo.save.mockRejectedValue(
      new QueryFailedError('INSERT INTO users', [], driverError),
    );

    await expect(
      service.provisionUser({
        email: 'eve@example.com',
        displayName: 'Eve',
        password: 'StrongPassw0rd!',
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);

    expect(outboxRepo.save).not.toHaveBeenCalled();
  });

  it('counts only unarchived admins', async () => {
    userRepository.count.mockResolvedValue(3);

    await expect(service.countActiveAdmins()).resolves.toBe(3);
    expect(userRepository.count).toHaveBeenCalledWith({
      where: { isAdmin: true, isArchived: false },
    });
  });

  // A full stored row whose hash matches the module-mocked hashValue digest
  // ('ab'.repeat(64) is 64 bytes in hex) and carries a 32-hex-char salt.
  const registeredUser = {
    uuid: FIXED_UUID,
    email: 'eve@example.com',
    displayName: 'Eve',
    passwordHash: 'ab'.repeat(64),
    passwordSalt: 'ab'.repeat(16),
    isActive: true,
    isAdmin: false,
    isLocked: false,
    failedLoginAttempts: 0,
    isArchived: false,
    roles: [],
  };

  describe('existsByEmail', () => {
    it('reports true when a matching account exists', async () => {
      userRepository.exists.mockResolvedValue(true);

      await expect(service.existsByEmail('eve@example.com')).resolves.toBe(
        true,
      );
      expect(userRepository.exists).toHaveBeenCalledWith({
        where: { email: 'eve@example.com' },
      });
    });

    it('reports false when no account exists', async () => {
      userRepository.exists.mockResolvedValue(false);

      await expect(service.existsByEmail('ghost@example.com')).resolves.toBe(
        false,
      );
    });
  });

  describe('findActiveUserByEmail', () => {
    it('returns an un-archived account tied to the email', async () => {
      userRepository.findOneBy.mockResolvedValue(registeredUser);

      await expect(
        service.findActiveUserByEmail('eve@example.com'),
      ).resolves.toEqual({
        uuid: FIXED_UUID,
        email: 'eve@example.com',
        displayName: 'Eve',
        profilePictureUrl: null,
        roles: [],
        isAdmin: false,
      });
      expect(userRepository.findOneBy).toHaveBeenCalledWith({
        email: 'eve@example.com',
        isArchived: false,
      });
    });

    it('returns null when no un-archived account exists', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findActiveUserByEmail('ghost@example.com'),
      ).resolves.toBeNull();
    });
  });

  describe('updatePassword', () => {
    it('re-hashes the new password with a fresh salt and persists it (F8.5.2)', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        passwordHash: 'old-hash',
        passwordSalt: 'old-salt',
      });

      await expect(
        service.updatePassword(FIXED_UUID, 'NewStrongPassw0rd!'),
      ).resolves.toBeUndefined();

      expect(userRepository.findOneByOrFail).toHaveBeenCalledWith({
        uuid: FIXED_UUID,
      });
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: FIXED_UUID,
          passwordHash: 'ab'.repeat(64),
          passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
          isLocked: false,
        }),
      );
    });

    it('clears the lock on a successful reset', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isLocked: true,
        failedLoginAttempts: 10,
      });

      await service.updatePassword(FIXED_UUID, 'NewStrongPassw0rd!');

      // The bootstrap admin is seated locked on a discarded password; the
      // reset write must unseat it in the same save as the new hash, and the
      // unlock also resets the failed-attempt counter (F6.3.1 → F8).
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: FIXED_UUID,
          isLocked: false,
          failedLoginAttempts: 0,
        }),
      );
    });

    it('rejects a user id with no matching account', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(
        new EntityNotFoundError(User, { uuid: FIXED_UUID }),
      );

      await expect(
        service.updatePassword(FIXED_UUID, 'NewStrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lets non-entity look-up failures propagate', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(new Error('db down'));

      await expect(
        service.updatePassword(FIXED_UUID, 'NewStrongPassw0rd!'),
      ).rejects.toThrow('db down');
    });
  });

  describe('checkUserAndReturnInfo', () => {
    it('returns the public info when the credentials match', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).resolves.toEqual({
        uuid: FIXED_UUID,
        email: 'eve@example.com',
        displayName: 'Eve',
        profilePictureUrl: null,
        roles: [],
        isAdmin: false,
      });

      // The supplied password is re-hashed with the stored salt for the
      // constant-time comparison.
      expect(vi.mocked(hashValue)).toHaveBeenCalledWith(
        'StrongPassw0rd!',
        'ab'.repeat(16),
      );
      expect(userRepository.findOneByOrFail).toHaveBeenCalledWith({
        email: 'eve@example.com',
      });
    });

    it('rejects a wrong password as unauthorized', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);
      manager.findOneBy.mockResolvedValue({ ...registeredUser });
      vi.mocked(hashValue).mockResolvedValueOnce('cd'.repeat(64));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'WrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('records a failed attempt serialised per account (F6.1.1, F6.1.2)', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);
      manager.findOneBy.mockResolvedValue({ ...registeredUser });
      vi.mocked(hashValue).mockResolvedValueOnce('cd'.repeat(64));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'WrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);

      // The increment runs behind a per-account advisory lock and re-reads the
      // row inside the transaction before mutating it.
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [expect.any(Number)],
      );
      expect(manager.findOneBy).toHaveBeenCalledWith(User, {
        uuid: FIXED_UUID,
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: FIXED_UUID,
          failedLoginAttempts: 1,
          isLocked: false,
        }),
      );
    });

    it('locks the account when the counter reaches the threshold (F6.3)', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);
      manager.findOneBy.mockResolvedValue({
        ...registeredUser,
        failedLoginAttempts: 9,
      });
      vi.mocked(hashValue).mockResolvedValueOnce('cd'.repeat(64));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'WrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: FIXED_UUID,
          failedLoginAttempts: 10,
          isLocked: true,
        }),
      );
    });

    it('does not record an attempt for a locked account (F6.1: increment before lockout check)', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isLocked: true,
      });
      vi.mocked(hashValue).mockResolvedValueOnce('cd'.repeat(64));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'WrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not record an attempt for an archived account', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isArchived: true,
      });
      vi.mocked(hashValue).mockResolvedValueOnce('cd'.repeat(64));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'WrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('clears the counter on a successful login (F6.1)', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        failedLoginAttempts: 5,
      });

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).resolves.toEqual({
        uuid: FIXED_UUID,
        email: 'eve@example.com',
        displayName: 'Eve',
        profilePictureUrl: null,
        roles: [],
        isAdmin: false,
      });

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: FIXED_UUID,
          failedLoginAttempts: 0,
        }),
      );
    });

    it('does not write on a successful login with a clean counter', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(registeredUser);

      await service.checkUserAndReturnInfo(
        'eve@example.com',
        'StrongPassw0rd!',
      );

      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown email as unauthorized, not a 500', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(
        new EntityNotFoundError(User, { email: 'ghost@example.com' }),
      );

      await expect(
        service.checkUserAndReturnInfo('ghost@example.com', 'Whatever123!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a locked account', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isLocked: true,
      });

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an archived account', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        isArchived: true,
      });

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('fails the check instead of crashing on a corrupt stored hash', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        passwordHash: 'ab',
      });
      manager.findOneBy.mockResolvedValue({ ...registeredUser });

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lets non-entity look-up failures propagate', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(new Error('db down'));

      await expect(
        service.checkUserAndReturnInfo('eve@example.com', 'StrongPassw0rd!'),
      ).rejects.toThrow('db down');
    });
  });

  describe('getUserByUuid', () => {
    it('returns the user plus their persisted roles and admin flag', async () => {
      userRepository.findOneBy.mockResolvedValue({
        ...registeredUser,
        roles: [Role.Requester, Role.Courier],
      });

      await expect(service.getUserByUuid(FIXED_UUID)).resolves.toEqual({
        uuid: FIXED_UUID,
        email: 'eve@example.com',
        displayName: 'Eve',
        profilePictureUrl: null,
        roles: [Role.Requester, Role.Courier],
        isAdmin: false,
      });
      expect(userRepository.findOneBy).toHaveBeenCalledWith({
        uuid: FIXED_UUID,
      });
    });

    it('returns null when the account no longer exists', async () => {
      userRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getUserByUuid(FIXED_UUID)).resolves.toBeNull();
    });
  });

  describe('getActiveUserByUuid', () => {
    it('returns an active account', async () => {
      userRepository.findOneBy.mockResolvedValue({ ...registeredUser, roles: [] });

      await expect(service.getActiveUserByUuid(FIXED_UUID)).resolves.toMatchObject({
        uuid: FIXED_UUID,
      });
    });

    it.each([
      ['missing', null],
      ['archived', { ...registeredUser, roles: [], isArchived: true }],
      ['locked', { ...registeredUser, roles: [], isLocked: true }],
    ])('returns null for a %s account', async (_, row) => {
      userRepository.findOneBy.mockResolvedValue(row);

      await expect(service.getActiveUserByUuid(FIXED_UUID)).resolves.toBeNull();
    });

    it('treats a missing roles value as an empty set', async () => {
      userRepository.findOneBy.mockResolvedValue({
        ...registeredUser,
        roles: undefined,
      });

      await expect(service.getUserByUuid(FIXED_UUID)).resolves.toMatchObject({
        roles: [],
      });
    });
  });

  describe('updateRoles', () => {
    it('persists the set-replaced roles and returns the stored state', async () => {
      const storedUser = {
        ...registeredUser,
        roles: [Role.Courier],
      };
      userRepository.findOneByOrFail.mockResolvedValue(storedUser);
      // The save mock stamps a uuid back onto the row; assign an explicit
      // post-save roles value to model a real subsequent read.
      userRepository.save.mockImplementation(async (row) => ({
        ...row,
        uuid: FIXED_UUID,
      }));

      await expect(
        service.updateRoles(FIXED_UUID, [Role.Requester, Role.Courier]),
      ).resolves.toEqual({
        uuid: FIXED_UUID,
        email: 'eve@example.com',
        displayName: 'Eve',
        profilePictureUrl: null,
        roles: [Role.Requester, Role.Courier],
        isAdmin: false,
      });

      expect(userRepository.findOneByOrFail).toHaveBeenCalledWith({
        uuid: FIXED_UUID,
      });
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: FIXED_UUID,
          roles: [Role.Requester, Role.Courier],
        }),
      );
    });

    it('normalises duplicate roles to a set', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        roles: [],
      });

      const saved = await service.updateRoles(FIXED_UUID, [
        Role.Requester,
        Role.Requester,
      ]);

      expect(saved.roles).toEqual([Role.Requester]);
    });

    it('allows opting out of every role', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...registeredUser,
        roles: [Role.Requester],
      });

      await expect(service.updateRoles(FIXED_UUID, [])).resolves.toMatchObject({
        roles: [],
      });
    });

    it('rejects a user id with no matching account', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(
        new EntityNotFoundError(User, { uuid: FIXED_UUID }),
      );

      await expect(
        service.updateRoles(FIXED_UUID, [Role.Requester]),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lets non-entity look-up failures propagate', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(new Error('db down'));

      await expect(
        service.updateRoles(FIXED_UUID, [Role.Requester]),
      ).rejects.toThrow('db down');
    });
  });

  describe('updateProfile', () => {
    const makeStoredUser = () => ({
      ...registeredUser,
      profilePictureUrl: 'https://example.com/avatar.png',
    });

    it('updates only the fields present in the request', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(makeStoredUser());

      await expect(
        service.updateProfile(FIXED_UUID, { displayName: 'Eve Newman' }),
      ).resolves.toEqual({
        uuid: FIXED_UUID,
        email: 'eve@example.com',
        displayName: 'Eve Newman',
        profilePictureUrl: 'https://example.com/avatar.png',
        roles: [],
        isAdmin: false,
      });

      expect(userRepository.findOneByOrFail).toHaveBeenCalledWith({
        uuid: FIXED_UUID,
      });
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          uuid: FIXED_UUID,
          displayName: 'Eve Newman',
          profilePictureUrl: 'https://example.com/avatar.png',
        }),
      );
    });

    it('sets the profile picture URL when supplied', async () => {
      userRepository.findOneByOrFail.mockResolvedValue({
        ...makeStoredUser(),
        profilePictureUrl: null,
      });

      await service.updateProfile(FIXED_UUID, {
        profilePictureUrl: 'https://example.com/new.png',
      });

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Eve',
          profilePictureUrl: 'https://example.com/new.png',
        }),
      );
    });

    it('clears the profile picture URL when null is supplied', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(makeStoredUser());

      await service.updateProfile(FIXED_UUID, { profilePictureUrl: null });

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ profilePictureUrl: null }),
      );
    });

    it('persists the unchanged profile for a request with neither field', async () => {
      userRepository.findOneByOrFail.mockResolvedValue(makeStoredUser());

      await expect(
        service.updateProfile(FIXED_UUID, {}),
      ).resolves.toMatchObject({
        displayName: 'Eve',
        profilePictureUrl: 'https://example.com/avatar.png',
      });

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          displayName: 'Eve',
          profilePictureUrl: 'https://example.com/avatar.png',
        }),
      );
    });

    it('rejects a user id with no matching account', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(
        new EntityNotFoundError(User, { uuid: FIXED_UUID }),
      );

      await expect(
        service.updateProfile(FIXED_UUID, { displayName: 'Eve Newman' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lets non-entity look-up failures propagate', async () => {
      userRepository.findOneByOrFail.mockRejectedValue(new Error('db down'));

      await expect(
        service.updateProfile(FIXED_UUID, { displayName: 'Eve Newman' }),
      ).rejects.toThrow('db down');
    });
  });

  describe('adminUpdateUser', () => {
    const ACTOR_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const TARGET_UUID = FIXED_UUID;

    const adminActor = {
      uuid: ACTOR_UUID,
      email: 'admin@example.com',
      displayName: 'Admin',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: 'ab'.repeat(16),
      isAdmin: true,
      isLocked: false,
      isArchived: false,
      roles: [],
      profilePictureUrl: null,
    };

    const targetUser = {
      uuid: TARGET_UUID,
      email: 'eve@example.com',
      displayName: 'Eve',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: 'ab'.repeat(16),
      isAdmin: false,
      isLocked: false,
      isArchived: false,
      roles: [],
      profilePictureUrl: null,
    };

    it('promotes a user and records the audit entry in the same transaction', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).resolves.toEqual({ ...targetUser, isAdmin: true });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: TARGET_UUID, isAdmin: true }),
      );
      const expectedAuditRow = {
        actorUuid: ACTOR_UUID,
        targetUuid: TARGET_UUID,
        changedFields: { isAdmin: { from: false, to: true } },
      };
      expect(manager.create).toHaveBeenCalledWith(
        UserUpdateAudit,
        expectedAuditRow,
      );
      expect(manager.save).toHaveBeenCalledWith(expectedAuditRow);
    });

    it('takes the advisory lock before counting admins, serialising concurrent changes', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(2);

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isAdmin: false,
      });

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1::bigint)',
        [expect.any(Number)],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.count.mock.invocationCallOrder[0],
      );
    });

    it('demotes an admin while another active admin remains', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(2);

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: false }),
      ).resolves.toEqual({ ...targetUser });

      expect(manager.create).toHaveBeenCalledWith(UserUpdateAudit, {
        actorUuid: ACTOR_UUID,
        targetUuid: TARGET_UUID,
        changedFields: { isAdmin: { from: true, to: false } },
      });
    });

    it('rejects demoting the last active admin (F11.4 mitigation)', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(0);

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: false }),
      ).rejects.toThrow(ConflictException);

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('rejects when the acting account is no longer an admin (stale-token defence)', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...adminActor,
        isAdmin: false,
      });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).rejects.toThrow(ForbiddenException);

      expect(manager.count).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rejects when the acting account no longer exists', async () => {
      manager.findOneBy.mockResolvedValueOnce(null);

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a locked acting account', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...adminActor,
        isLocked: true,
      });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an archived acting account', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...adminActor,
        isArchived: true,
      });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reports 404 when the target account does not exist', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce(null);

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).rejects.toThrow(NotFoundException);

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns the current state without writing an audit entry when nothing changes', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: false }),
      ).resolves.toEqual({ ...targetUser });

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('treats an empty update as a no-op', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {}),
      ).resolves.toEqual({ ...targetUser });

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('archives a target account and records the archival in the audit entry (F12.2)', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isArchived: true }),
      ).resolves.toEqual({ ...targetUser, isArchived: true });

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: TARGET_UUID, isArchived: true }),
      );
      expect(manager.create).toHaveBeenCalledWith(UserUpdateAudit, {
        actorUuid: ACTOR_UUID,
        targetUuid: TARGET_UUID,
        changedFields: { isArchived: { from: false, to: true } },
      });
    });

    it('un-archives a target account (F12.3)', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isArchived: true });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isArchived: false }),
      ).resolves.toEqual({ ...targetUser });

      expect(manager.create).toHaveBeenCalledWith(UserUpdateAudit, {
        actorUuid: ACTOR_UUID,
        targetUuid: TARGET_UUID,
        changedFields: { isArchived: { from: true, to: false } },
      });
    });

    it('records both changes in a single audit entry when both flags move', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isAdmin: true,
        isArchived: true,
      });

      expect(manager.create).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(UserUpdateAudit, {
        actorUuid: ACTOR_UUID,
        targetUuid: TARGET_UUID,
        changedFields: {
          isAdmin: { from: false, to: true },
          isArchived: { from: false, to: true },
        },
      });
    });

    it('refuses to archive the last remaining active admin (F12.2)', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(0);

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isArchived: true }),
      ).rejects.toThrow(ConflictException);

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('archives an admin while another active admin remains', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(2);

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isArchived: true }),
      ).resolves.toEqual({ ...targetUser, isAdmin: true, isArchived: true });
    });

    it('treats a re-archive as a no-op with no audit entry', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isArchived: true });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isArchived: true }),
      ).resolves.toEqual({ ...targetUser, isArchived: true });

      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalled();
    });

    it('records an admin block once the demotion has committed', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(2);

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isAdmin: false,
      });

      expect(authorizationService.createAdminBlock).toHaveBeenCalledTimes(1);
      expect(authorizationService.createAdminBlock).toHaveBeenCalledWith(
        TARGET_UUID,
      );

      // The block is written only after the in-transaction writes, i.e.
      // after the demotion has committed.
      expect(
        authorizationService.createAdminBlock.mock.invocationCallOrder[0],
      ).toBeGreaterThan(manager.save.mock.invocationCallOrder[0]);
    });

    it('clears the admin block on promotion', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isAdmin: true,
      });

      // A demoted-then-re-promoted admin must not stay blocked, so the
      // block key is removed (a no-op in redis when absent).
      expect(authorizationService.removeAdminBlock).toHaveBeenCalledTimes(1);
      expect(authorizationService.removeAdminBlock).toHaveBeenCalledWith(
        TARGET_UUID,
      );
      expect(authorizationService.createAdminBlock).not.toHaveBeenCalled();
    });

    it('does not block when the requested demotion is a no-op', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isAdmin: false,
      });

      expect(authorizationService.createAdminBlock).not.toHaveBeenCalled();
    });

    it('does not block when archiving only, even an admin', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(2);

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isArchived: true,
      });

      expect(authorizationService.createAdminBlock).not.toHaveBeenCalled();
    });

    it('does not block when the demotion never commits (last active admin rejected)', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(0);

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: false }),
      ).rejects.toThrow(ConflictException);

      expect(authorizationService.createAdminBlock).not.toHaveBeenCalled();
    });

    it('does not block when the transaction rolls back after applying the demotion', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(2);

      // Models a commit failure: the callback applied the demotion, but the
      // transaction never committed, so the block must not be recorded.
      dataSource.transaction.mockImplementation(
        async (callback: (m: typeof manager) => Promise<unknown>) => {
          await callback(manager);
          throw new Error('commit failed');
        },
      );

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: false }),
      ).rejects.toThrow('commit failed');

      expect(authorizationService.createAdminBlock).not.toHaveBeenCalled();
    });

    it('removes the admin block only after the promotion has committed', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isAdmin: true,
      });

      // The block is removed only after the in-transaction writes, i.e.
      // after the promotion has committed.
      expect(
        authorizationService.removeAdminBlock.mock.invocationCallOrder[0],
      ).toBeGreaterThan(manager.save.mock.invocationCallOrder[0]);
    });

    it('does not remove the block when the promotion request is a no-op', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isAdmin: true,
      });

      expect(authorizationService.removeAdminBlock).not.toHaveBeenCalled();
      expect(authorizationService.createAdminBlock).not.toHaveBeenCalled();
    });

    it('does not remove the block when archiving only, even an admin', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser, isAdmin: true });
      manager.count.mockResolvedValue(2);

      await service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, {
        isArchived: true,
      });

      expect(authorizationService.removeAdminBlock).not.toHaveBeenCalled();
      expect(authorizationService.createAdminBlock).not.toHaveBeenCalled();
    });

    it('does not remove the block when the promotion never applies (actor no longer admin)', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...adminActor,
        isAdmin: false,
      });

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).rejects.toThrow(ForbiddenException);

      expect(authorizationService.removeAdminBlock).not.toHaveBeenCalled();
    });

    it('does not remove the block when the transaction rolls back after applying the promotion', async () => {
      manager.findOneBy
        .mockResolvedValueOnce(adminActor)
        .mockResolvedValueOnce({ ...targetUser });

      // Models a commit failure: the callback applied the promotion, but the
      // transaction never committed, so the block must not be removed.
      dataSource.transaction.mockImplementation(
        async (callback: (m: typeof manager) => Promise<unknown>) => {
          await callback(manager);
          throw new Error('commit failed');
        },
      );

      await expect(
        service.adminUpdateUser(ACTOR_UUID, TARGET_UUID, { isAdmin: true }),
      ).rejects.toThrow('commit failed');

      expect(authorizationService.removeAdminBlock).not.toHaveBeenCalled();
    });
  });

  describe('archiveSelf', () => {
    const selfUser = {
      uuid: FIXED_UUID,
      email: 'eve@example.com',
      displayName: 'Eve',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: 'ab'.repeat(16),
      isAdmin: false,
      isLocked: false,
      isArchived: false,
      roles: [],
      profilePictureUrl: null,
    };

    it("archives the caller's own account (F12.1)", async () => {
      manager.findOneBy.mockResolvedValueOnce({ ...selfUser });

      await expect(service.archiveSelf(FIXED_UUID)).resolves.toEqual({
        ...selfUser,
        isArchived: true,
      });

      expect(manager.findOneBy).toHaveBeenCalledWith(User, {
        uuid: FIXED_UUID,
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ uuid: FIXED_UUID, isArchived: true }),
      );
    });

    it('writes no audit entry for a self-initiated archive', async () => {
      manager.findOneBy.mockResolvedValueOnce({ ...selfUser });

      await service.archiveSelf(FIXED_UUID);

      expect(manager.create).not.toHaveBeenCalled();
    });

    it('is a no-op when the account is already archived', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...selfUser,
        isArchived: true,
      });

      await expect(service.archiveSelf(FIXED_UUID)).resolves.toMatchObject({
        isArchived: true,
      });

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rejects when the account no longer exists', async () => {
      manager.findOneBy.mockResolvedValueOnce(null);

      await expect(service.archiveSelf(FIXED_UUID)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses an admin archiving themself as the last active admin', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...selfUser,
        isAdmin: true,
      });
      manager.count.mockResolvedValue(0);

      await expect(service.archiveSelf(FIXED_UUID)).rejects.toThrow(
        ConflictException,
      );

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('takes the advisory lock before counting admins, serialising the check', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...selfUser,
        isAdmin: true,
      });
      manager.count.mockResolvedValue(2);

      await service.archiveSelf(FIXED_UUID);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1::bigint)',
        [expect.any(Number)],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.count.mock.invocationCallOrder[0],
      );
    });
  });

  describe('adminCreateUser', () => {
    const ACTOR_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const adminActor = {
      uuid: ACTOR_UUID,
      email: 'admin@example.com',
      displayName: 'Admin',
      passwordHash: 'ab'.repeat(64),
      passwordSalt: 'ab'.repeat(16),
      isAdmin: true,
      isLocked: false,
      isArchived: false,
      roles: [],
      profilePictureUrl: null,
    };

    const fields = {
      email: 'eve@example.com',
      displayName: 'Eve',
      roles: [Role.Requester],
      profilePictureUrl: 'https://example.com/avatar.png',
      isAdmin: false,
    };

    it('provisions a locked, un-archived account with a discarded random password', async () => {
      manager.findOneBy.mockResolvedValueOnce(adminActor);

      const user = await service.adminCreateUser(ACTOR_UUID, fields);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.findOneBy).toHaveBeenCalledWith(User, {
        uuid: ACTOR_UUID,
      });
      expect(manager.create).toHaveBeenCalledWith(
        User,
        expect.objectContaining({
          email: 'eve@example.com',
          displayName: 'Eve',
          uuid: expect.stringMatching(UUID_PATTERN),
          passwordHash: 'ab'.repeat(64),
          passwordSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
          isArchived: false,
          isAdmin: false,
          isLocked: true,
          roles: [Role.Requester],
          profilePictureUrl: 'https://example.com/avatar.png',
        }),
      );

      // The plaintext password is never surfaced: hashed with a fresh salt and
      // absent from both the returned user and the audit record.
      expect(vi.mocked(hashValue)).toHaveBeenCalledWith(
        expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expect.stringMatching(/^[0-9a-f]{32}$/),
      );
      expect(user).not.toHaveProperty('password');
    });

    it('defaults an omitted role set to empty and dedupes supplied roles', async () => {
      manager.findOneBy.mockResolvedValueOnce(adminActor);

      const user = await service.adminCreateUser(ACTOR_UUID, {
        email: 'eve@example.com',
        displayName: 'Eve',
        roles: [Role.Requester, Role.Requester],
      });

      expect(manager.create).toHaveBeenCalledWith(
        User,
        expect.objectContaining({ roles: [Role.Requester] }),
      );
      expect(user.roles).toEqual([Role.Requester]);
    });

    it('takes the advisory lock before re-reading the acting admin, serialising against privilege changes', async () => {
      manager.findOneBy.mockResolvedValueOnce(adminActor);

      await service.adminCreateUser(ACTOR_UUID, fields);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1::bigint)',
        [expect.any(Number)],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOneBy.mock.invocationCallOrder[0],
      );
    });

    it('records the insert as a set of from-null changes in the same transaction', async () => {
      manager.findOneBy.mockResolvedValueOnce(adminActor);

      const user = await service.adminCreateUser(ACTOR_UUID, fields);

      const expectedAuditRow = {
        actorUuid: ACTOR_UUID,
        targetUuid: expect.stringMatching(UUID_PATTERN),
        changedFields: {
          email: { from: null, to: 'eve@example.com' },
          displayName: { from: null, to: 'Eve' },
          roles: { from: null, to: [Role.Requester] },
          isAdmin: { from: null, to: false },
          isLocked: { from: null, to: true },
          isArchived: { from: null, to: false },
          profilePictureUrl: {
            from: null,
            to: 'https://example.com/avatar.png',
          },
        },
      };
      expect(manager.create).toHaveBeenCalledWith(
        UserUpdateAudit,
        expectedAuditRow,
      );
      expect(manager.save).toHaveBeenLastCalledWith(expectedAuditRow);
      expect(user.uuid).toBeDefined();
    });

    it('omits an unset profile picture from the audit record', async () => {
      manager.findOneBy.mockResolvedValueOnce(adminActor);

      await service.adminCreateUser(ACTOR_UUID, {
        email: 'eve@example.com',
        displayName: 'Eve',
      });

      const auditCreateCall = vi
        .mocked(manager.create)
        .mock.calls.find(([entity]) => entity === UserUpdateAudit);
      expect(auditCreateCall).toBeDefined();
      expect(auditCreateCall![1].changedFields).not.toHaveProperty(
        'profilePictureUrl',
      );
    });

    it('never audits credentials', async () => {
      manager.findOneBy.mockResolvedValueOnce(adminActor);

      await service.adminCreateUser(ACTOR_UUID, fields);

      const auditCreateCall = vi
        .mocked(manager.create)
        .mock.calls.find(([entity]) => entity === UserUpdateAudit);
      expect(auditCreateCall).toBeDefined();
      expect(auditCreateCall![1].changedFields).not.toHaveProperty(
        'passwordHash',
      );
      expect(auditCreateCall![1].changedFields).not.toHaveProperty(
        'passwordSalt',
      );
    });

    it('rejects when the acting account is no longer an admin (stale-token defence)', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...adminActor,
        isAdmin: false,
      });

      await expect(service.adminCreateUser(ACTOR_UUID, fields)).rejects.toThrow(
        ForbiddenException,
      );

      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rejects when the acting account no longer exists', async () => {
      manager.findOneBy.mockResolvedValueOnce(null);

      await expect(service.adminCreateUser(ACTOR_UUID, fields)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a locked acting account', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...adminActor,
        isLocked: true,
      });

      await expect(service.adminCreateUser(ACTOR_UUID, fields)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects an archived acting account', async () => {
      manager.findOneBy.mockResolvedValueOnce({
        ...adminActor,
        isArchived: true,
      });

      await expect(service.adminCreateUser(ACTOR_UUID, fields)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a duplicate email with a conflict', async () => {
      manager.findOneBy.mockResolvedValueOnce(adminActor);
      const driverError = Object.assign(new Error('duplicate key value'), {
        code: '23505',
      });
      manager.save.mockRejectedValueOnce(
        new QueryFailedError('INSERT INTO users', [], driverError),
      );

      await expect(service.adminCreateUser(ACTOR_UUID, fields)).rejects.toThrow(
        ConflictException,
      );

      expect(manager.create).not.toHaveBeenCalledWith(
        UserUpdateAudit,
        expect.anything(),
      );
    });
  });

  describe('listUsers', () => {
    it('lists the whole directory in a stable order with the paged window', async () => {
      userRepository.findAndCount.mockResolvedValue([
        [
          { uuid: '11111111-1111-4111-8111-111111111111' },
          { uuid: '22222222-2222-4222-8222-222222222222' },
        ],
        42,
      ]);

      await expect(
        service.listUsers({ offset: 0, limit: 25 }),
      ).resolves.toEqual({
        users: [
          { uuid: '11111111-1111-4111-8111-111111111111' },
          { uuid: '22222222-2222-4222-8222-222222222222' },
        ],
        total: 42,
        offset: 0,
        limit: 25,
      });

      // Unfiltered: empty where, N3.1.2 default window, deterministic
      // ordering for stable pagination across pages.
      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 25,
        order: { uuid: 'ASC' },
      });
    });

    it('filters by a participant role via array containment (F10.3)', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.listUsers({ role: Role.Requester, offset: 5, limit: 10 });

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: { roles: ArrayContains([Role.Requester]) },
        skip: 5,
        take: 10,
        order: { uuid: 'ASC' },
      });
    });

    it('combines the admin-only account flags when supplied (F10.4)', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.listUsers({
        isAdmin: true,
        isLocked: false,
        isArchived: true,
        offset: 0,
        limit: 1,
      });

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: { isAdmin: true, isLocked: false, isArchived: true },
        skip: 0,
        take: 1,
        order: { uuid: 'ASC' },
      });
    });

    it('clamps a requested limit to the 1000 hard ceiling (N3.1.1)', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listUsers({ offset: 0, limit: 5000 });

      expect(result.limit).toBe(1000);
      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1000 }),
      );
    });

    it('floors a negative offset to the first page', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listUsers({ offset: -5, limit: 1 });

      expect(result.offset).toBe(0);
      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('raises a sub-minimum limit to one row', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.listUsers({ offset: 0, limit: 0 });

      expect(result.limit).toBe(1);
      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1 }),
      );
    });
  });
});
