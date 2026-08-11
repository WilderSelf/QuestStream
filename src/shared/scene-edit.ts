/**
 * Pure scene-draft editing logic (grimoire Phase 2). A SceneDraft is the editable,
 * renderer-side working copy of a Scene document; every mutation goes through
 * reduceDraft so the builder UI is glue only. Editing a draft NEVER touches the
 * live mix — drafts talk to the preview bus and scenes.save, nothing else.
 */
import type { AmbienceMode, EndOfListPolicy, Scene, ScenePad } from './types'
import { clamp01 } from './num'

/** One editable ambience layer — one sound per layer (matches the live mixer model). */
export interface DraftLayer {
  songId: string
  volume: number
  playing: boolean
  mode: AmbienceMode
  minIntervalSec: number
  maxIntervalSec: number
}

export interface SceneDraft {
  sceneId?: string // present when editing an existing scene
  name: string
  note?: string
  songIds: string[]
  currentIndex: number
  musicVolume: number
  ambience: DraftLayer[]
  pads: ScenePad[]
  endOfList?: EndOfListPolicy
  crossfadeMs?: number
}

/** A plain snapshot of the live mix, captured by the caller (keeps the reducer pure). */
export interface LiveMixSnapshot {
  songIds: string[]
  currentIndex: number
  musicVolume: number
  layers: DraftLayer[]
}

export type DraftAction =
  | { type: 'set-name'; name: string }
  | { type: 'set-note'; note: string }
  | { type: 'add-song'; songId: string; index?: number }
  | { type: 'remove-song'; index: number }
  | { type: 'move-song'; from: number; to: number }
  | { type: 'set-start-index'; index: number }
  | { type: 'set-music-volume'; volume: number }
  | { type: 'set-crossfade'; crossfadeMs?: number }
  | { type: 'set-end-of-list'; policy?: EndOfListPolicy }
  | { type: 'add-layer'; songId: string }
  | { type: 'remove-layer'; index: number }
  | { type: 'set-layer-volume'; index: number; volume: number }
  | { type: 'set-layer-mode'; index: number; mode: AmbienceMode }
  | { type: 'set-layer-interval'; index: number; minSec: number; maxSec: number }
  | { type: 'add-pad'; pad: ScenePad }
  | { type: 'remove-pad'; index: number }
  | { type: 'set-pad'; index: number; patch: Partial<ScenePad> }
  | { type: 'copy-live-mix'; snapshot: LiveMixSnapshot }

export const DEFAULT_LAYER_MIN_SEC = 20
export const DEFAULT_LAYER_MAX_SEC = 60

/** Start a draft — blank, or as the editable copy of an existing scene. */
export function newDraft(from?: Scene): SceneDraft {
  if (!from) {
    return {
      name: '',
      songIds: [],
      currentIndex: 0,
      musicVolume: 1,
      ambience: [],
      pads: []
    }
  }
  return {
    sceneId: from.id,
    name: from.name,
    ...(from.note !== undefined ? { note: from.note } : {}),
    songIds: [...from.songIds],
    currentIndex: from.currentIndex,
    musicVolume: from.musicVolume,
    // Legacy multi-song pools expand to one single-sound layer per pool entry —
    // the same expansion recallScene performs.
    ambience: from.ambience.flatMap((a) => {
      const ids = a.pool && a.pool.length > 0 ? a.pool : [a.songId]
      return ids.map((songId) => ({
        songId,
        volume: a.volume,
        playing: a.playing,
        mode: a.mode ?? ('loop' as const),
        minIntervalSec: a.minIntervalSec ?? DEFAULT_LAYER_MIN_SEC,
        maxIntervalSec: a.maxIntervalSec ?? DEFAULT_LAYER_MAX_SEC
      }))
    }),
    pads: (from.pads ?? []).map((p) => ({ ...p })),
    ...(from.endOfList !== undefined ? { endOfList: from.endOfList } : {}),
    ...(from.crossfadeMs !== undefined ? { crossfadeMs: from.crossfadeMs } : {})
  }
}

const clampIndex = (i: number, len: number): number => Math.max(0, Math.min(i, Math.max(0, len - 1)))

export function reduceDraft(draft: SceneDraft, action: DraftAction): SceneDraft {
  switch (action.type) {
    case 'set-name':
      return { ...draft, name: action.name }
    case 'set-note':
      return { ...draft, note: action.note }
    case 'add-song': {
      const at = action.index ?? draft.songIds.length
      const songIds = [...draft.songIds]
      songIds.splice(at, 0, action.songId)
      const currentIndex = at <= draft.currentIndex && draft.songIds.length > 0
        ? draft.currentIndex + 1
        : draft.currentIndex
      return { ...draft, songIds, currentIndex }
    }
    case 'remove-song': {
      const songIds = draft.songIds.filter((_, i) => i !== action.index)
      let currentIndex = draft.currentIndex
      if (action.index < currentIndex) currentIndex -= 1
      return { ...draft, songIds, currentIndex: clampIndex(currentIndex, songIds.length) }
    }
    case 'move-song': {
      const { from, to } = action
      if (from === to) return draft
      const songIds = [...draft.songIds]
      const [moved] = songIds.splice(from, 1)
      songIds.splice(to, 0, moved)
      // The start marker follows the song it pointed at.
      let currentIndex = draft.currentIndex
      if (currentIndex === from) currentIndex = to
      else if (from < currentIndex && to >= currentIndex) currentIndex -= 1
      else if (from > currentIndex && to <= currentIndex) currentIndex += 1
      return { ...draft, songIds, currentIndex }
    }
    case 'set-start-index':
      return { ...draft, currentIndex: clampIndex(action.index, draft.songIds.length) }
    case 'set-music-volume':
      return { ...draft, musicVolume: clamp01(action.volume) }
    case 'set-crossfade':
      return action.crossfadeMs === undefined
        ? stripKey(draft, 'crossfadeMs')
        : { ...draft, crossfadeMs: Math.max(0, action.crossfadeMs) }
    case 'set-end-of-list':
      return action.policy === undefined
        ? stripKey(draft, 'endOfList')
        : { ...draft, endOfList: action.policy }
    case 'add-layer':
      return {
        ...draft,
        ambience: [
          ...draft.ambience,
          {
            songId: action.songId,
            volume: 0.5,
            playing: true,
            mode: 'loop',
            minIntervalSec: DEFAULT_LAYER_MIN_SEC,
            maxIntervalSec: DEFAULT_LAYER_MAX_SEC
          }
        ]
      }
    case 'remove-layer':
      return { ...draft, ambience: draft.ambience.filter((_, i) => i !== action.index) }
    case 'set-layer-volume':
      return {
        ...draft,
        ambience: draft.ambience.map((l, i) =>
          i === action.index ? { ...l, volume: clamp01(action.volume) } : l
        )
      }
    case 'set-layer-mode':
      return {
        ...draft,
        ambience: draft.ambience.map((l, i) => (i === action.index ? { ...l, mode: action.mode } : l))
      }
    case 'set-layer-interval': {
      const minSec = Math.max(1, Math.floor(action.minSec))
      const maxSec = Math.max(minSec, Math.floor(action.maxSec))
      return {
        ...draft,
        ambience: draft.ambience.map((l, i) =>
          i === action.index ? { ...l, minIntervalSec: minSec, maxIntervalSec: maxSec } : l
        )
      }
    }
    case 'add-pad':
      return { ...draft, pads: [...draft.pads, { ...action.pad }] }
    case 'remove-pad':
      return { ...draft, pads: draft.pads.filter((_, i) => i !== action.index) }
    case 'set-pad':
      return {
        ...draft,
        pads: draft.pads.map((p, i) => (i === action.index ? { ...p, ...action.patch } : p))
      }
    case 'copy-live-mix':
      return {
        ...draft,
        songIds: [...action.snapshot.songIds],
        currentIndex: clampIndex(action.snapshot.currentIndex, action.snapshot.songIds.length),
        musicVolume: clamp01(action.snapshot.musicVolume),
        ambience: action.snapshot.layers.map((l) => ({ ...l }))
      }
  }
}

function stripKey<K extends 'crossfadeMs' | 'endOfList'>(draft: SceneDraft, key: K): SceneDraft {
  const next = { ...draft }
  delete next[key]
  return next
}

/** The payload for scenes.save — mirrors the renderer's snapshot convention exactly
 *  (single-song `pool` kept for back-compat), with undefined-valued keys omitted so the
 *  persisted JSON gains no noise. */
export function draftToSceneInput(draft: SceneDraft): Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
} {
  return {
    ...(draft.sceneId !== undefined ? { id: draft.sceneId } : {}),
    name: draft.name.trim() || 'Untitled Scene',
    songIds: [...draft.songIds],
    musicVolume: draft.musicVolume,
    currentIndex: clampIndex(draft.currentIndex, draft.songIds.length),
    ambience: draft.ambience.map((l) => ({
      songId: l.songId,
      volume: l.volume,
      playing: l.playing,
      mode: l.mode,
      pool: [l.songId],
      minIntervalSec: l.minIntervalSec,
      maxIntervalSec: l.maxIntervalSec
    })),
    ...(draft.note !== undefined && draft.note !== '' ? { note: draft.note } : {}),
    ...(draft.pads.length > 0 ? { pads: draft.pads.map((p) => ({ ...p })) } : {}),
    ...(draft.endOfList !== undefined ? { endOfList: draft.endOfList } : {}),
    ...(draft.crossfadeMs !== undefined ? { crossfadeMs: draft.crossfadeMs } : {})
  }
}

/** True when saving would change (or create) the scene. */
export function isDirty(draft: SceneDraft, saved?: Scene): boolean {
  if (!saved) {
    // A brand-new draft is "dirty" once it has anything worth saving.
    const blank = newDraft()
    return JSON.stringify(draftToSceneInput({ ...draft, sceneId: undefined })) !==
      JSON.stringify(draftToSceneInput(blank))
  }
  return JSON.stringify(draftToSceneInput(draft)) !== JSON.stringify(draftToSceneInput(newDraft(saved)))
}
