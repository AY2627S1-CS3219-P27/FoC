import type { Status } from '../lifecycle/status.js';
import type { TransitionInput } from '../lifecycle/transition.js';

// What a builder is given when a request comes in.
export interface ActionContext {
  callerId: string; // req.user.sub, already verified by JwtAuthGuard
  // The validated body. Only withdraw and adjust have one.
  body?: { reason?: string; newAmount?: number };
}

// One errand action: which edge it takes, and how to fill in what that edge needs.
export interface ActionSpec {
  expected: Status;
  to: Status;
  // Returns only the parts that differ per action. The controller adds
  // errandId, actor and idempotencyKey itself.
  build: (ctx: ActionContext) => Pick<TransitionInput, 'set' | 'payload'>;
}

// The fixed-edge errand actions (cancel is separate: it has two possible
// starting statuses). `satisfies` checks every row against ActionSpec while
// keeping the exact keys, so ActionName below is the real list of actions.
export const ACTIONS = {
  // Courier takes an Open errand; the courier is always the caller.
  accept: {
    expected: 'Open',
    to: 'Accepted',
    build: (ctx) => ({ set: { courierId: ctx.callerId } }),
  },
  // Server time, not the client's: a client clock can be wrong or faked.
  pickup: {
    expected: 'Accepted',
    to: 'Picked Up',
    build: () => ({ set: { pickedUpAt: new Date() } }),
  },
  deliver: {
    expected: 'Picked Up',
    to: 'Delivered',
    build: () => ({ set: { deliveredAt: new Date() } }),
  },
  // Requester confirms delivery; credit then transfers to the courier.
  confirm: {
    expected: 'Delivered',
    to: 'Transferring-Credit',
    build: () => ({}),
  },
  incomplete: {
    expected: 'Delivered',
    to: 'Incomplete',
    build: () => ({}),
  },
  // Courier backs out before pickup; F7.4 requires a reason (event payload, not a column).
  withdraw: {
    expected: 'Accepted',
    to: 'Open',
    build: (ctx) => ({ payload: { reason: ctx.body?.reason } }),
  },
  // Requester changes the reward; the new amount waits in the payload until credit agrees.
  adjust: {
    expected: 'Open',
    to: 'Adjusting-Credit',
    build: (ctx) => ({ payload: { newAmount: ctx.body?.newAmount } }),
  },
} satisfies Record<string, ActionSpec>;

export type ActionName = keyof typeof ACTIONS;
