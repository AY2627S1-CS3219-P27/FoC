/**
 * The possible participation roles that a user may
 * take part in in FoC.
 */
export enum Role {
  Requester = 'requester',
  Courier = 'courier',
}

const ROLE_VALUES: ReadonlySet<string> = new Set(Object.values(Role));

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLE_VALUES.has(value);
}
