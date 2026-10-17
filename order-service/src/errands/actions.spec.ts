import { findEdge } from '../lifecycle/edges.js';
import { payloadValid } from '../lifecycle/payloads.js';
import { ACTIONS } from './actions.js';

const ctx = {
  callerId: '11111111-1111-4111-8111-111111111111',
  body: { reason: 'bike broke down', newAmount: 9 },
};
const rows = Object.entries(ACTIONS);

// The table must stay in step with edges.ts and payloads.ts, which is what
// transition() checks at runtime. These catch a drift in a unit test instead.
describe('ACTIONS', () => {
  it.each(rows)('%s takes a real edge', (_, a) => {
    expect(findEdge(a.expected, a.to)).toBeDefined();
  });

  it.each(rows)('%s fills exactly the columns its edge sets', (_, a) => {
    const { set } = a.build(ctx) as { set?: object };
    expect(Object.keys(set ?? {}).sort()).toEqual(
      [...findEdge(a.expected, a.to)!.sets].sort(),
    );
  });

  it.each(rows)('%s builds a payload its event type accepts', (_, a) => {
    const { payload } = a.build(ctx) as { payload?: object };
    expect(payloadValid(findEdge(a.expected, a.to)!.type, payload)).toBe(true);
  });

  it('accept makes the caller the courier', () => {
    expect(ACTIONS.accept.build(ctx).set.courierId).toBe(ctx.callerId);
  });

  it('pickup and deliver stamp the server time', () => {
    const before = Date.now();
    const pickedUpAt = ACTIONS.pickup.build().set.pickedUpAt;
    const deliveredAt = ACTIONS.deliver.build().set.deliveredAt;
    for (const at of [pickedUpAt, deliveredAt]) {
      expect(at).toBeInstanceOf(Date);
      expect(at.getTime()).toBeGreaterThanOrEqual(before);
      expect(at.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });
});
