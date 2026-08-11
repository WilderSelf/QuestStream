/**
 * The ⌘K seeker's ranker (grimoire Phase 8). Pure: the overlay hands it the
 * library + context and renders the grouped hits verbatim. Reuses the tag
 * type-ahead's scorer so "find" feels identical everywhere.
 */
import { scoreQuery } from './tag-suggest'
import type { Scene, Song } from './types'

export interface SeekerAction {
  id: string
  label: string
  aliases?: string[]
}

export interface SeekerContext {
  songs: Song[]
  scenes: Scene[]
  /** Song ids of the open/on-air scene: matches rank in their own boosted group. */
  sceneScopeSongIds?: string[]
  actions?: SeekerAction[]
}

export type SeekerGroup = 'scene' | 'scenes' | 'library' | 'actions'

export interface SeekerHit {
  group: SeekerGroup
  id: string
  label: string
  sub?: string
}

const DEFAULT_CAPS: Record<SeekerGroup, number> = { scene: 5, scenes: 4, library: 6, actions: 4 }

/** Score a set of candidates and return them best-first (ties keep input order). */
function ranked<T>(items: T[], score: (item: T) => number | null): T[] {
  return items
    .map((item, seq) => ({ item, score: score(item), seq }))
    .filter((x): x is { item: T; score: number; seq: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.seq - b.seq)
    .map((x) => x.item)
}

export function rankSeeker(
  query: string,
  ctx: SeekerContext,
  caps: Partial<Record<SeekerGroup, number>> = {}
): SeekerHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const cap = { ...DEFAULT_CAPS, ...caps }
  const scope = new Set(ctx.sceneScopeSongIds ?? [])

  const sceneTracks = ranked(
    ctx.songs.filter((s) => scope.has(s.id)),
    (s) => scoreQuery(q, s.title, s.title)
  )
    .slice(0, cap.scene)
    .map((s): SeekerHit => ({ group: 'scene', id: s.id, label: s.title, sub: 'In this scene' }))

  const scenes = ranked(ctx.scenes, (sc) => scoreQuery(q, sc.name, sc.name))
    .slice(0, cap.scenes)
    .map((sc): SeekerHit => ({ group: 'scenes', id: sc.id, label: sc.name, sub: 'Scene' }))

  // Library: everything NOT already surfaced in the scene-scope group.
  const library = ranked(
    ctx.songs.filter((s) => !scope.has(s.id)),
    (s) => scoreQuery(q, s.title, s.title)
  )
    .slice(0, cap.library)
    .map((s): SeekerHit => ({ group: 'library', id: s.id, label: s.title }))

  const actions = ranked(ctx.actions ?? [], (a) => {
    const scores = [
      scoreQuery(q, a.label, a.label),
      ...(a.aliases ?? []).map((al) => scoreQuery(q, al, al))
    ].filter((x): x is number => x !== null)
    return scores.length ? Math.min(...scores) : null
  })
    .slice(0, cap.actions)
    .map((a): SeekerHit => ({ group: 'actions', id: a.id, label: a.label, sub: 'Action' }))

  return [...sceneTracks, ...scenes, ...library, ...actions]
}
