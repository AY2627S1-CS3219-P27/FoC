import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import { recordAudit } from '../audit/record-audit.js';
import type { Brand } from '../database/entities/index.js';
import { BrandsService } from './brands.service.js';

// The audit log is covered against a real database (test/audit-writes); here
// the service's own rules are tested against mocks, and the entries it asks
// for are checked.
vi.mock('../audit/record-audit.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

function setup(existing: Partial<Brand> | null = null, saveError?: unknown) {
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
    service: new BrandsService(repository as unknown as Repository<Brand>),
    manager,
  };
}

const DUPLICATE = new QueryFailedError(
  'INSERT',
  [],
  Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint: 'UQ_brands_name_key_active',
  }),
);

beforeEach(() => {
  vi.mocked(recordAudit).mockClear();
});

describe('BrandsService', () => {
  it('keeps a name up to 100 characters (F3.1) and trims it', async () => {
    const { service } = setup();

    await expect(
      service.create(`  ${'x'.repeat(100)}  `),
    ).resolves.toMatchObject({ name: 'x'.repeat(100) });
  });

  it('creates a trimmed brand with a case-insensitive key', async () => {
    const { service } = setup();

    const brand = await service.create('  Cheers ');

    expect(brand).toMatchObject({
      name: 'Cheers',
      nameKey: 'cheers',
      retiredAt: null,
    });
    expect(brand.id).toEqual(expect.any(String));
  });

  it('records the creation, on the same transaction (F14.4)', async () => {
    const { service, manager } = setup();

    const brand = await service.create('Cheers');

    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(manager, {
      action: 'brand.created',
      targetType: 'brand',
      targetId: brand.id,
      after: { id: brand.id, name: 'Cheers', retiredAt: null },
    });
  });

  it('maps a clash with a non-retired brand to 409 DUPLICATE_NAME, recording nothing', async () => {
    const { service } = setup(null, DUPLICATE);

    const error = await service.create('cheers').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DUPLICATE_NAME',
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('renames and re-keys an existing brand, recording before and after', async () => {
    const { service, manager } = setup({
      id: 'x1',
      name: 'Cheers',
      nameKey: 'cheers',
      retiredAt: null,
    });

    await expect(service.rename('x1', 'Newco')).resolves.toMatchObject({
      name: 'Newco',
      nameKey: 'newco',
    });

    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(manager, {
      action: 'brand.renamed',
      targetType: 'brand',
      targetId: 'x1',
      before: { id: 'x1', name: 'Cheers', retiredAt: null },
      after: { id: 'x1', name: 'Newco', retiredAt: null },
    });
  });

  it('refuses to rename a retired brand, recording nothing', async () => {
    const { service, manager } = setup({
      id: 'x1',
      name: 'Cheers',
      nameKey: 'cheers',
      retiredAt: new Date(),
    });

    const error = await service.rename('x1', 'Newco').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown brand, recording nothing', async () => {
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
    const active = setup({ id: 'x1', name: 'Cheers', retiredAt: null });
    const already = setup({ id: 'x1', name: 'Cheers', retiredAt });

    await expect(active.service.retire('x1')).resolves.toMatchObject({
      retiredAt: expect.any(Date),
    });
    expect(recordAudit).toHaveBeenCalledExactlyOnceWith(
      active.manager,
      expect.objectContaining({
        action: 'brand.retired',
        before: { id: 'x1', name: 'Cheers', retiredAt: null },
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
