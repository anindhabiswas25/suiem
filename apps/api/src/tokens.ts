/** DI tokens. Explicit tokens everywhere: Suiem does not rely on emitDecoratorMetadata. */
export const ENV = Symbol("ENV");
export const DB = Symbol("DB");
export const REDIS = Symbol("REDIS");
export const LOGGER = Symbol("LOGGER");
export const CLOCK = Symbol("CLOCK");

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
