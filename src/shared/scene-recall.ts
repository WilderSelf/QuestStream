/**
 * Pure recall-plan builder (grimoire Phase 5): turns a Scene document into the
 * concrete queue/layers to apply, extracted from store.recallScene so the scene
 * page's Play controls (partial recall, start-here) share one pinned behavior.
 */
import type { AmbienceMode, Scene, Song } from './types'

export const DEFAULT_RECALL_MIN_SEC = 20
export const DEFAULT_RECALL_MAX_SEC = 60

export interface RecallLayer {
  song: Song
  volume: number
  playing: boolean
  mode: AmbienceMode
  minSec: number
  maxSec: number
}

export interface RecallOptions {
  includeMusic?: boolean // default true; false = leave the live queue playing untouched
  includeAmbience?: boolean // default true; false = leave the live layers untouched
  startIndex?: number // override the scene's start track ("start scene here")
}

export interface RecallPlan {
  /** null = don't touch the live queue (includeMusic: false). */
  music: { songs: Song[]; startIndex: number; musicVolume: number } | null
  /** null = don't touch the live layers (includeAmbience: false). */
  ambience: RecallLayer[] | null
  /** The scene's transition length; null = legacy scene → caller uses the app default. */
  crossfadeMs: number | null
}

/**
 * Missing songs are filtered (a half-broken scene recalls what it can), legacy
 * multi-song pools expand to one single-sound layer per entry, and the start index
 * addresses the FILTERED list with the `items[i] ?? items[0]` fallback — all exactly
 * as the inline recallScene did (pinned by tests/scene-recall.test.ts).
 */
export function buildRecallPlan(
  scene: Scene,
  songsById: Record<string, Song>,
  opts: RecallOptions = {}
): RecallPlan {
  const { includeMusic = true, includeAmbience = true } = opts

  let music: RecallPlan['music'] = null
  if (includeMusic) {
    const songs = scene.songIds.map((id) => songsById[id]).filter((s): s is Song => !!s)
    const raw = opts.startIndex ?? scene.currentIndex
    const startIndex = raw >= 0 && raw < songs.length ? raw : 0
    music = { songs, startIndex, musicVolume: scene.musicVolume }
  }

  let ambience: RecallPlan['ambience'] = null
  if (includeAmbience) {
    ambience = scene.ambience.flatMap((a) => {
      const pool = (a.pool ?? [a.songId]).map((id) => songsById[id]).filter((s): s is Song => !!s)
      return pool.map((song) => ({
        song,
        volume: a.volume,
        playing: a.playing,
        mode: a.mode ?? ('loop' as const),
        minSec: a.minIntervalSec ?? DEFAULT_RECALL_MIN_SEC,
        maxSec: a.maxIntervalSec ?? DEFAULT_RECALL_MAX_SEC
      }))
    })
  }

  return { music, ambience, crossfadeMs: scene.crossfadeMs ?? null }
}
