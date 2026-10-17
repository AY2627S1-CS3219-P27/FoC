import type { Status } from '../lifecycle/status.js';
import type { TransitionInput } from '../lifecycle/transition.js';

// What a builder is given when a request comes in.
export interface ActionContext {
  callerId: string; 
  body?: { reason?: string; newAmount?: number };
}

// One errand action: which edge it takes, and how to fill in what that edge needs.
export interface ActionSpec {
  expected: Status;
  to: Status;
  build: (ctx: ActionContext) => Pick<TransitionInput, 'set' | 'payload'>;
}

export const ACTIONS = {
  accept: {
    expected: 'Open',
    to: 'Accepted',
    build: (ctx) => ({ set: { courierId: ctx.callerId } }),
  },
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
  withdraw: {
    expected: 'Accepted',
    to: 'Open',
    build: (ctx) => ({ payload: { reason: ctx.body?.reason } }),
  },
  adjust: {
    expected: 'Open',
    to: 'Adjusting-Credit',
    build: (ctx) => ({ payload: { newAmount: ctx.body?.newAmount } }),
  },
} satisfies Record<string, ActionSpec>;

export type ActionName = keyof typeof ACTIONS;
