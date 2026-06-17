// Pure helpers for the randomized ("organic one-shot") ambience scheduler. Kept in
// their own module — free of discord.js/electron imports — so the headless unit
// tests can exercise them with a seeded RNG.

/** A delay in ms chosen uniformly within [minSec, maxSec]. Clamps to ≥1s and min≤max. */
export function pickNextDelay(minSec: number, maxSec: number, rnd: () => number = Math.random): number {
  const lo = Number.isFinite(minSec) ? Math.max(1, minSec) : 1
  const hi = Number.isFinite(maxSec) ? Math.max(lo, maxSec) : lo
  return Math.round((lo + rnd() * (hi - lo)) * 1000)
}

/** A random element of a non-empty pool, or null if the pool is empty. */
export function pickFromPool<T>(pool: T[] | undefined, rnd: () => number = Math.random): T | null {
  if (!pool || pool.length === 0) return null
  return pool[Math.floor(rnd() * pool.length)] ?? null
}
