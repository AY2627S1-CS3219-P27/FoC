import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountEventContractValidator } from './account-event-contract.validator.js';
import { NOTIFICATION_NOTIFY_V1_ROUTING_KEY } from './events/notification-notify/v1/contract.js';

const validator = new AccountEventContractValidator();

const envelope = (
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  eventId: randomUUID(),
  eventType: 'NotificationNotify',
  timestamp: '2026-10-11T08:30:00.000Z',
  publisher: 'notification-service',
  payload,
  ...overrides,
});

const payload = () => ({
  notificationGuid: randomUUID(),
  userId: randomUUID(),
  content: { title: 'Errand accepted', body: 'Your errand was accepted.' },
});

describe('notification.notify.v1', () => {
  it('accepts a well-formed notification event', () => {
    const result = validator.validate(
      NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
      envelope(payload()),
    );

    expect(result.valid).toBe(true);
  });

  it('rejects a notification guid that is not a uuid', () => {
    const result = validator.validate(
      NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
      envelope({ ...payload(), notificationGuid: 'not-a-uuid' }),
    );

    expect(result).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it('rejects content without a body', () => {
    const result = validator.validate(
      NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
      envelope({
        notificationGuid: randomUUID(),
        userId: randomUUID(),
        content: { title: 'Errand accepted' },
      }),
    );

    expect(result).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it('rejects unknown payload fields', () => {
    const result = validator.validate(
      NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
      envelope({ ...payload(), unexpected: true }),
    );

    expect(result).toMatchObject({ valid: false, code: 'INVALID_PAYLOAD' });
  });

  it('rejects a foreign publisher', () => {
    const result = validator.validate(
      NOTIFICATION_NOTIFY_V1_ROUTING_KEY,
      envelope(payload(), { publisher: 'order-service' }),
    );

    expect(result).toMatchObject({ valid: false, code: 'INVALID_ENVELOPE' });
  });
});
