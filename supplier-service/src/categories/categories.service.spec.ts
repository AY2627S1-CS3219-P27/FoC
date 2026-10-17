import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, type Repository } from 'typeorm';
import type { Category } from '../database/entities/index.js';
import { CategoriesService } from './categories.service.js';

function setup(existing: Partial<Category> | null = null, saveError?: unknown) {
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
    service: new CategoriesService(
      repository as unknown as Repository<Category>,
    ),
    repository,
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

  it('maps a clash with a non-retired category to 409 DUPLICATE_NAME', async () => {
    const { service } = setup(null, DUPLICATE);

    const error = await service.create('food').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DUPLICATE_NAME',
    });
  });

  it('renames and re-keys an existing category', async () => {
    const { service } = setup({ id: 'c1', name: 'Food', nameKey: 'food' });

    await expect(service.rename('c1', 'Meals')).resolves.toMatchObject({
      name: 'Meals',
      nameKey: 'meals',
    });
  });

  it('refuses to rename a retired category, like buildings (review #605)', async () => {
    const { service, repository } = setup({
      id: 'c1',
      name: 'Food',
      nameKey: 'food',
      retiredAt: new Date(),
    });

    const error = await service.rename('c1', 'Meals').catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown category', async () => {
    const { service } = setup(null);

    await expect(service.rename('nope', 'Meals')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.retire('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('retires once and treats a second retire as a no-op', async () => {
    const retiredAt = new Date('2026-09-01T00:00:00Z');
    const active = setup({ id: 'c1', retiredAt: null });
    const already = setup({ id: 'c1', retiredAt });

    await expect(active.service.retire('c1')).resolves.toMatchObject({
      retiredAt: expect.any(Date),
    });
    await expect(already.service.retire('c1')).resolves.toMatchObject({
      retiredAt,
    });
    expect(already.repository.save).not.toHaveBeenCalled();
  });
});
