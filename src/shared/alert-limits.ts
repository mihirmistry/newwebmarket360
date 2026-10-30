// Validation limits shared by the admin form (browser) and the API (server).
export const SIGNAL_MIN = -100;
export const SIGNAL_MAX = 100;
export const NAME_MAX_LENGTH = 80;
export const DESCRIPTION_MAX_LENGTH = 300;
export const MAX_ALERTS = 200;

/** Signal values may have at most 2 decimal places (stored as NUMERIC(6,2)). */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}
