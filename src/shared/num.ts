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

// Crossfade bounds shared by the player, scenes, and pack validation.
export const DEFAULT_CROSSFADE_MS = 2500
export const CROSSFADE_MAX_MS = 20_000

/**
 * Clamp a crossfade length to [0, CROSSFADE_MAX_MS]. Unlike clampNum, garbage
 * (non-number over IPC / untrusted JSON) falls back to the DEFAULT — clamping a
 * corrupt value to 0 would silently turn every transition into a hard cut.
 */
export const clampCrossfadeMs = (ms: unknown): number =>
  typeof ms === 'number' && Number.isFinite(ms)
    ? Math.min(CROSSFADE_MAX_MS, Math.max(0, ms))
    : DEFAULT_CROSSFADE_MS
