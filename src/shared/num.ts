/**
 * Clamp to [lo,hi], NaN/Infinity-safe. A non-finite value — or a non-number arriving
 * over IPC / untrusted JSON — clamps to `lo` rather than poisoning the value downstream.
 */
export const clampNum = (n: unknown, lo: number, hi: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo

/**
 * Clamp to [0,1], NaN/Infinity-safe: a non-finite value (e.g. parseFloat('') → NaN
 * arriving over IPC) clamps to 0 rather than poisoning a gain/volume downstream.
 */
export const clamp01 = (n: number): number => clampNum(n, 0, 1)
