/**
 * Pure state for the tag-triage workspace (grimoire Phase 7): a fixed batch of
 * songs auditioned and tagged one at a time. The reducer records save/skip
 * decisions; the UI performs the actual retag IPC from `saved` as it advances.
 */
import type { ItemKind } from './types'

export interface TriageRecord {
  songId: string
  tags: string[]
  kind: ItemKind
}

export interface TriageState {
  queue: string[] // song ids, fixed order
  index: number // current position; index === queue.length → complete
  workingTags: string[] // tags being edited for the current item
  workingKind: ItemKind
  carryForward: boolean
  lastSavedTags: string[] // seed for the next item while carry-forward is on
  saved: TriageRecord[]
  skippedIds: string[]
}

export type TriageAction =
  | { type: 'set-tags'; tags: string[] }
  | { type: 'set-kind'; kind: ItemKind }
  | { type: 'toggle-carry' }
  | { type: 'save-next' }
  | { type: 'skip' }

export function newTriage(
  songIds: string[],
  opts: { kind?: ItemKind; carryForward?: boolean } = {}
): TriageState {
  return {
    queue: [...songIds],
    index: 0,
    workingTags: [],
    workingKind: opts.kind ?? 'track',
    carryForward: opts.carryForward ?? false,
    lastSavedTags: [],
    saved: [],
    skippedIds: []
  }
}

export const triageComplete = (s: TriageState): boolean => s.index >= s.queue.length

export function reduceTriage(state: TriageState, action: TriageAction): TriageState {
  switch (action.type) {
    case 'set-tags':
      return triageComplete(state) ? state : { ...state, workingTags: [...action.tags] }
    case 'set-kind':
      return triageComplete(state) ? state : { ...state, workingKind: action.kind }
    case 'toggle-carry':
      return { ...state, carryForward: !state.carryForward }
    case 'save-next': {
      if (triageComplete(state)) return state
      const lastSavedTags = [...state.workingTags]
      return {
        ...state,
        saved: [
          ...state.saved,
          { songId: state.queue[state.index], tags: lastSavedTags, kind: state.workingKind }
        ],
        lastSavedTags,
        index: state.index + 1,
        // Carry-forward: the next item starts from what was just saved.
        workingTags: state.carryForward ? lastSavedTags : []
      }
    }
    case 'skip':
      if (triageComplete(state)) return state
      return {
        ...state,
        skippedIds: [...state.skippedIds, state.queue[state.index]],
        index: state.index + 1,
        // A skip carries the last SAVED tags forward — never its own abandoned edits.
        workingTags: state.carryForward ? [...state.lastSavedTags] : []
      }
  }
}
