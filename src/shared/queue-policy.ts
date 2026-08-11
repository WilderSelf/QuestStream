/**
 * Pure next-track policy (grimoire Phase 2). Absorbs the branch logic that lived
 * inline in the renderer's playNext, and layers the per-scene end-of-list policy on
 * top. `endOfList: undefined` reproduces the legacy behavior exactly (global
 * repeat/shuffle settings decide the tail).
 *
 * Precedence, matching the old inline order:
 *   per-track loop (natural end only) > repeat-one (natural end only) > shuffle >
 *   sequential next > tail behavior (endOfList if set, else repeat-all/stop).
 */
import type { EndOfListPolicy } from './types'

export interface NextTrackState {
  /** Index of the current track in the queue, or -1 when nothing is current. */
  index: number
  length: number
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  /** The current track's own loop setting. */
  trackLoop: 'off' | 'on' | 'once'
  /** True when the track ended on its own (vs. the user pressing next). */
  auto: boolean
  endOfList?: EndOfListPolicy
}

export type NextTrackDecision =
  | { kind: 'stop' }
  | { kind: 'replay'; consumeTrackLoop?: boolean }
  | { kind: 'index'; index: number }

/** Pick a random index in [0, length) that isn't `avoid` (unless it's the only one). */
function randomIndex(length: number, avoid: number, rand: () => number): number {
  if (length <= 1) return 0
  const pool: number[] = []
  for (let i = 0; i < length; i++) if (i !== avoid) pool.push(i)
  return pool[Math.floor(rand() * pool.length)] ?? 0
}

export function nextQueueIndex(state: NextTrackState, rand: () => number): NextTrackDecision {
  const { index, length, shuffle, repeat, trackLoop, auto, endOfList } = state
  if (length === 0) return { kind: 'stop' }
  const hasCurrent = index >= 0

  // Per-track loop wins over everything, but only on a natural finish.
  if (auto && hasCurrent && trackLoop === 'on') return { kind: 'replay' }
  if (auto && hasCurrent && trackLoop === 'once') return { kind: 'replay', consumeTrackLoop: true }

  // Repeat-one only auto-repeats when a track finishes on its own.
  if (auto && hasCurrent && repeat === 'one') return { kind: 'replay' }

  if (shuffle) return { kind: 'index', index: randomIndex(length, index, rand) }

  const next = index + 1
  if (next < length) return { kind: 'index', index: next }

  // End of the list.
  switch (endOfList) {
    case 'loop-list':
      return { kind: 'index', index: 0 }
    case 'loop-last':
      return hasCurrent ? { kind: 'replay' } : { kind: 'index', index: length - 1 }
    case 'shuffle':
      return { kind: 'index', index: randomIndex(length, index, rand) }
    case 'stop':
      return { kind: 'stop' }
    case undefined:
      // Legacy tail: global repeat-all wraps, otherwise stop.
      return repeat === 'all' ? { kind: 'index', index: 0 } : { kind: 'stop' }
  }
}
