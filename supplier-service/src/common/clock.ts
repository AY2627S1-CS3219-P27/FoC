/** The current time, injectable so time-dependent results can be tested. */
export type Clock = () => Date;
export const CLOCK = Symbol('CLOCK');
export const systemClock: Clock = () => new Date();
