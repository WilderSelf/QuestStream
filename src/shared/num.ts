/**
 * Clamp to [0,1], NaN/Infinity-safe: a non-finite value (e.g. parseFloat('') → NaN
 * arriving over IPC) clamps to 0 rather than poisoning a gain/volume downstream.
 */
export const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
