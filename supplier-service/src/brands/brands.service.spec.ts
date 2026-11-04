import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { Brand } from '../database/entities/index.js';
import { BrandsService } from './brands.service.js';

function setup(existing: Partial<Brand> | null = null, saveError?: unknown) {
  const repository = {
    create: vi.fn((values: object) => ({ ...values })),
    save: vi.fn(async (values: object) => {
      if (saveError) {
        throw saveError;
      }
      return values;
    }),
    findOneBy: vi.fn(async () => existing),
  };
  return {
    service: new BrandsService(repository as unknown as Repository<Brand>),
    repository,
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

describe('BrandsService', () => {
  it('keeps a name up to 100 characters (F3.1) and trims it', async () => {
    const { service } = setup();

    await expect(
      service.create(`  ${'x'.repeat(100)}  `),
    ).resolves.toMatchObject({
      name: 'x'.repeat(100),
    });
  });

  it('creates a trimmed brand with a case-insensitive key', async () => {
    const { service } = setup();

    const brand = await service.create('  Acme ');

    expect(brand).toMatchObject({
      name: 'Acme',
      nameKey: 'acme',
      retiredAt: null,
    });
    expect(brand.id).toEqual(expect.any(String));
  });

  it('maps a clash with a non-retired brand to 409 DUPLICATE_NAME', async () => {
    const { service } = setup(null, DUPLICATE);

    const error = await service.create('acme').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('renames and re-keys an existing brand', async () => {
    const { service } = setup({ id: 'b1', name: 'Acme', nameKey: 'acme' });

    await expect(service.rename('b1', 'Newco')).resolves.toMatchObject({
      name: 'Newco',
      nameKey: 'newco',
    });
  });

  it('refuses to rename a retired brand', async () => {
    const { service, repository } = setup({
      id: 'b1',
      name: 'Acme',
      nameKey: 'acme',
      retiredAt: new Date(),
    });

    const error = await service.rename('b1', 'Newco').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown brand', async () => {
    const { service } = setup(null);

    await expect(service.rename('nope', 'Newco')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.retire('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('retires once and treats a second retire as a no-op', async () => {
    const retiredAt = new Date('2026-09-01T00:00:00Z');
    const active = setup({ id: 'b1', retiredAt: null });
    const already = setup({ id: 'b1', retiredAt });

    await expect(active.service.retire('b1')).resolves.toMatchObject({
      retiredAt: expect.any(Date),
    });
    await expect(already.service.retire('b1')).resolves.toMatchObject({
      retiredAt,
    });
    expect(already.repository.save).not.toHaveBeenCalled();
  });
});
