import { QueryFailedError } from 'typeorm';
import { isUniqueViolation } from './postgres-errors.js';

function pgError(code: string, constraint?: string) {
  return Object.assign(new Error('duplicate key'), { code, constraint });
}

describe('isUniqueViolation', () => {
  it('matches a wrapped unique violation on the named constraint', () => {
    const error = new QueryFailedError(
      'INSERT',
      [],
      pgError('23505', 'PK_building_name_keys'),
    );
    expect(isUniqueViolation(error, 'PK_building_name_keys')).toBe(true);
  });

  it('ignores other constraints and other error codes', () => {
    const other = new QueryFailedError('INSERT', [], pgError('23505', 'PK_x'));
    const check = new QueryFailedError(
      'INSERT',
      [],
      pgError('23514', 'PK_building_name_keys'),
    );
    expect(isUniqueViolation(other, 'PK_building_name_keys')).toBe(false);
    expect(isUniqueViolation(check, 'PK_building_name_keys')).toBe(false);
    expect(isUniqueViolation(undefined, 'PK_building_name_keys')).toBe(false);
  });
});
