import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { recordAudit } from '../audit/record-audit.js';
import type { Category } from '../database/entities/index.js';
import { CategoriesService } from './categories.service.js';

// The audit log is covered against a real database (test/audit-writes); here
// the service's own rules are tested against mocks, and the entries it asks
// for are checked.
vi.mock('../audit/record-audit.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

function setup(existing: Partial<Category> | null = null, saveError?: unknown) {
  const manager = {
    findOne: vi.fn(async () => existing),
    save: vi.fn(async (values: object) => {
      if (saveError) {
        throw saveError;
      }
      return values;
    }),
  };
  const repository = {
    create: vi.fn((values: object) => ({ ...values })),
    manager: {
      transaction: vi.fn(async (work: (m: typeof manager) => unknown) =>
        work(manager),
      ),
    },
  };
  return {
    service: new CategoriesService(
      repository as unknown as Repository<Category>,
    ),
    manager,
  };
}

const DUPLICATE = new QueryFailedError(
  'INSERT',
  [],
  Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'UQ_categories_name_key_active',
  }),
);

beforeEach(() => {
  vi.mocked(recordAudit).mockClear();
});

describe('CategoriesService', () => {
  it('creates a trimmed category with a case-insensitive key', async () => {
    const { service } = setup();

    const category = await service.create('  Food ');

    expect(category).toMatchObject({
      name: 'Food',
      nameKey: 'food',
      retiredAt: null,
    });
    expect(category.id).toEqual(expect.any(String));
  });

  it('records the creation, on the same transaction (F14.4)', async () => {
    const { service, manager } = setup();

    const category = await service.create('Food');

    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(manager, {
      action: 'category.created',
      targetType: 'category',
      targetId: category.id,
      after: { id: category.id, name: 'Food', retiredAt: null },
    });
  });

  it('maps a clash with a non-retired category to 409 DUPLICATE_NAME, recording nothing', async () => {
    const { service } = setup(null, DUPLICATE);

    const error = await service.create('food').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DUPLICATE_NAME',
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('renames and re-keys an existing category, recording before and after', async () => {
    const { service, manager } = setup({
      id: 'x1',
      name: 'Food',
      nameKey: 'food',
      retiredAt: null,
    });

    await expect(service.rename('x1', 'Newco')).resolves.toMatchObject({
      name: 'Newco',
      nameKey: 'newco',
    });

    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(manager, {
      action: 'category.renamed',
      targetType: 'category',
      targetId: 'x1',
      before: { id: 'x1', name: 'Food', retiredAt: null },
      after: { id: 'x1', name: 'Newco', retiredAt: null },
    });
  });

  it('refuses to rename a retired category, recording nothing', async () => {
    const { service, manager } = setup({
      id: 'x1',
      name: 'Food',
      nameKey: 'food',
      retiredAt: new Date(),
    });

    const error = await service.rename('x1', 'Newco').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown category, recording nothing', async () => {
    const { service } = setup(null);

    await expect(service.rename('nope', 'Newco')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.retire('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('retires once, recording it, and treats a second retire as a no-op that records nothing', async () => {
    const retiredAt = new Date('2026-09-01T00:00:00Z');
    const active = setup({ id: 'x1', name: 'Food', retiredAt: null });
    const already = setup({ id: 'x1', name: 'Food', retiredAt });

    await expect(active.service.retire('x1')).resolves.toMatchObject({
      retiredAt: expect.any(Date),
    });
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
      active.manager,
      expect.objectContaining({
        action: 'category.retired',
        before: { id: 'x1', name: 'Food', retiredAt: null },
      }),
    );

    vi.mocked(recordAudit).mockClear();
    await expect(already.service.retire('x1')).resolves.toMatchObject({
      retiredAt,
    });
    expect(already.manager.save).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
