/**
 * Pure state for the import workbench (grimoire Phase 6): the arriving-items
 * table is a fold of library:importProgress events, and the Untagged inbox is a
 * selector over the library. No IPC, no time — the workbench UI is glue only.
 */
import type { ImportProgress, Song } from './types'

export interface ImportRow {
  url: string
  status: ImportProgress['status']
  message?: string
  total?: number
  completed?: number
  addedSongIds: string[]
  duplicateOfSongId?: string
}

const TERMINAL: ReadonlySet<ImportRow['status']> = new Set(['done', 'duplicate', 'error'])

/**
 * Fold one progress event into the rows (newest row first). Rows are keyed by
 * source url. Terminal states are sticky: a straggling non-terminal event can't
 * resurrect a finished row — except a fresh 'resolving', which is the start of a
 * NEW import attempt and gets its own row.
 */
export function reduceImportRows(rows: ImportRow[], ev: ImportProgress): ImportRow[] {
  const at = rows.findIndex((r) => r.url === ev.url)
  const existing = at >= 0 ? rows[at] : undefined

  const merged = (base: ImportRow | undefined): ImportRow => ({
    url: ev.url,
    status: ev.status,
    ...(ev.message !== undefined ? { message: ev.message } : base?.message !== undefined ? { message: base.message } : {}),
    ...(ev.total !== undefined ? { total: ev.total } : base?.total !== undefined ? { total: base.total } : {}),
    ...(ev.completed !== undefined
      ? { completed: ev.completed }
      : base?.completed !== undefined
        ? { completed: base.completed }
        : {}),
    addedSongIds: ev.addedSongIds ?? base?.addedSongIds ?? [],
    ...(ev.duplicateOfSongId !== undefined
      ? { duplicateOfSongId: ev.duplicateOfSongId }
      : base?.duplicateOfSongId !== undefined
        ? { duplicateOfSongId: base.duplicateOfSongId }
        : {})
  })

  if (!existing) return [merged(undefined), ...rows]

  if (TERMINAL.has(existing.status)) {
    // A fresh 'resolving' = a new attempt for the same source; anything else is a straggler.
    if (ev.status === 'resolving') return [merged(undefined), ...rows]
    return rows
  }

  const next = [...rows]
  next[at] = merged(existing)
  return next
}

/** True when a song carries no tags at all (the triage inbox criterion). */
export function isUntagged(song: Song): boolean {
  return !song.tags || song.tags.length === 0
}

/** Untagged songs, newest-added first — the workbench's "Untagged" section. */
export function untaggedInbox(songs: Song[]): Song[] {
  return songs.filter(isUntagged).sort((a, b) => b.addedAt - a.addedAt)
}
