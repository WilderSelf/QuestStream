// The tag taxonomy that drives the library browser. A library item has exactly one
// `kind` (track / ambience / sfx — see ItemKind in types.ts) which decides its pane,
// and a flat `tags: string[]` whose entries are namespaced `"<dimension>:<value>"`
// strings (e.g. "genre:fantasy", "location:tavern"). Namespacing lets the UI group
// items into collapsible accordion sections by dimension while keeping the on-disk
// shape a plain string[] — so .questpack export/import and the retag IPC are
// unchanged. A tag with no colon is a "legacy / free" tag shown under an "Other"
// group; it stays searchable. Users can add their own dimensions and values freely
// (anything that parses as `dim:value` works) — the curated lists below are just the
// starter set surfaced as quick-pick chips.
//
// This module is pure and dependency-free so it imports cleanly into the main
// process, the renderer, AND the headless tests (same constraint as shared/num.ts).

import type { ItemKind } from './types'

export interface TagValue {
  value: string // slug, e.g. 'fantasy'
  label: string // display, e.g. 'Fantasy'
}

export interface Dimension {
  key: string // namespace, e.g. 'genre'
  label: string // display, e.g. 'Genre / Setting'
  values: TagValue[] // curated starter values (user-extensible at runtime)
}

const v = (value: string, label: string): TagValue => ({ value, label })

// The four shared dimensions. Every kind (track / ambience / sfx) is tagged from the
// SAME four axes so a GM tags one way everywhere; only the default grouping axis differs
// per kind (see TAXONOMY below). Existing slugs are preserved verbatim (e.g. 'scifi',
// 'peace', 'woods') so tags saved by earlier versions keep matching their curated chip —
// new values are only ever appended. See remapLegacyTag for the one-time migration of the
// retired 'weather' / 'category' dimensions.
const GENRE: Dimension = {
  key: 'genre',
  label: 'Genre / Setting',
  values: [
    v('fantasy', 'Fantasy'),
    v('scifi', 'Sci-Fi / Space'),
    v('cyberpunk', 'Cyberpunk'),
    v('horror', 'Horror'),
    v('modern', 'Modern'),
    v('historical', 'Historical'),
    v('western', 'Western'),
    v('steampunk', 'Steampunk'),
    v('post-apocalyptic', 'Post-Apocalyptic')
  ]
}

const LOCATION: Dimension = {
  key: 'location',
  label: 'Location',
  values: [
    v('tavern', 'Tavern'),
    v('town', 'Town / City'),
    v('woods', 'Woods'),
    v('wilderness', 'Wilderness'),
    v('docks', 'Docks'),
    v('dungeon', 'Dungeon'),
    v('cave', 'Cave'),
    v('ship', 'Ship'),
    v('castle', 'Castle'),
    v('temple', 'Temple'),
    v('swamp', 'Swamp'),
    v('underground', 'Underground'),
    v('desert', 'Desert'),
    v('mountains', 'Mountains'),
    v('graveyard', 'Graveyard'),
    v('market', 'Market'),
    v('camp', 'Camp')
  ]
}

const MOOD: Dimension = {
  key: 'mood',
  label: 'Mood',
  values: [
    v('tense', 'Tense'),
    v('peace', 'Peaceful'),
    v('somber', 'Somber'),
    v('triumphant', 'Triumphant'),
    v('mysterious', 'Mysterious'),
    v('eerie', 'Eerie'),
    v('whimsical', 'Whimsical'),
    v('epic', 'Epic'),
    v('melancholy', 'Melancholy'),
    v('romantic', 'Romantic'),
    v('foreboding', 'Foreboding')
  ]
}

const ACTIVITY: Dimension = {
  key: 'activity',
  label: 'Activity',
  values: [
    v('combat', 'Combat'),
    v('boss', 'Boss'),
    v('travel', 'Travel'),
    v('exploration', 'Exploration'),
    v('social', 'Social'),
    v('celebration', 'Celebration'),
    v('shopping', 'Shopping'),
    v('stealth', 'Stealth'),
    v('chase', 'Chase'),
    v('investigation', 'Investigation'),
    v('ritual', 'Ritual'),
    v('downtime', 'Downtime')
  ]
}

/**
 * The dimensions offered per kind. All kinds share the same four axes; the ORDER differs
 * so each kind groups by its most natural axis first (the FIRST dimension is the default
 * grouping axis in the browser): music → genre, ambience → location, soundboard → activity.
 */
export const TAXONOMY: Record<ItemKind, Dimension[]> = {
  track: [GENRE, ACTIVITY, MOOD, LOCATION],
  ambience: [LOCATION, MOOD, GENRE, ACTIVITY],
  sfx: [ACTIVITY, MOOD, GENRE, LOCATION]
}

/**
 * One-time migration of tags saved under the two dimensions retired when the taxonomy was
 * unified to genre/location/mood/activity. Only mappings with a clean equivalent are
 * rewritten; everything else (including the old `weather:*` beds and the non-combat
 * `category:*` sfx) is returned unchanged so it stays searchable as a free tag and the user
 * can retag at leisure. Pure + idempotent: a tag already in the new scheme passes through.
 */
const LEGACY_TAG_REMAP: Record<string, string> = {
  'category:combat': 'activity:combat'
}

export function remapLegacyTag(tag: string): string {
  return LEGACY_TAG_REMAP[normalizeTag(tag)] ?? tag
}

export const KIND_LABELS: Record<ItemKind, string> = {
  track: 'Music',
  ambience: 'Ambience',
  sfx: 'Soundboard'
}

export const KIND_ORDER: ItemKind[] = ['track', 'ambience', 'sfx']

/** One-line explainer for each kind, shown under the library tabs so the three content
 *  types are legible without exploring. */
export const KIND_HINTS: Record<ItemKind, string> = {
  track: 'Songs you queue and play one after another.',
  ambience: 'Background beds that loop or fire random one-shots — many can play at once.',
  sfx: 'One-shot buttons (a door knock, a sword clash) you trigger live, with optional hotkeys.'
}

/** Lowercase slug: trim, lowercase, collapse internal whitespace to single dashes. */
function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '-')
}

/** Title-case a slug for display when no curated label exists ('war-drums' → 'War Drums'). */
function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Split a tag into its dimension + value. Only the FIRST colon separates them, so a
 * value can't smuggle a second colon. A tag with no colon is "legacy / free" and
 * returns `{ dim: null }`.
 */
export function parseTag(tag: string): { dim: string | null; value: string } {
  const i = tag.indexOf(':')
  if (i < 0) return { dim: null, value: tag.trim() }
  return { dim: slug(tag.slice(0, i)), value: tag.slice(i + 1).trim() }
}

/** Build a normalized namespaced tag from a dimension + value. */
export function makeTag(dim: string, value: string): string {
  return `${slug(dim)}:${slug(value)}`
}

/**
 * Normalize a single tag for storage. Namespaced tags get a lowercased dimension AND
 * value (so 'Genre:Fantasy' → 'genre:fantasy', stable for grouping); legacy free tags
 * are only trimmed (case preserved, so a user's 'LoFi' stays 'LoFi').
 */
export function normalizeTag(tag: string): string {
  const t = tag.trim()
  if (!t) return ''
  const i = t.indexOf(':')
  if (i < 0) return t
  return makeTag(t.slice(0, i), t.slice(i + 1))
}

/** The dimensions defined for a kind (curated). */
export function dimensionsFor(kind: ItemKind): Dimension[] {
  return TAXONOMY[kind] ?? []
}

/** Default grouping dimension key for a kind (its first dimension). */
export function defaultGroupBy(kind: ItemKind): string {
  return TAXONOMY[kind]?.[0]?.key ?? ''
}

/** Human label for a (dimension, value) pair — curated label, else Title-Cased slug. */
export function labelForValue(dim: string, value: string): string {
  const d = Object.values(TAXONOMY)
    .flat()
    .find((dd) => dd.key === dim)
  const curated = d?.values.find((x) => x.value === value)
  return curated?.label ?? titleCase(value)
}

/** Human label for a dimension key — curated label, else Title-Cased slug. */
export function labelForDimension(dim: string): string {
  const d = Object.values(TAXONOMY)
    .flat()
    .find((dd) => dd.key === dim)
  return d?.label ?? titleCase(dim)
}

/**
 * The values present for a (kind, dimension) across the given songs, unioned with the
 * curated starter values, sorted with curated-order first then extras alphabetically.
 * Used to render the secondary filter chips (so user-added values appear too).
 */
export function valuesPresent(
  songs: { kind?: ItemKind; tags?: string[] }[],
  kind: ItemKind,
  dim: string
): TagValue[] {
  const curated = dimensionsFor(kind).find((d) => d.key === dim)?.values ?? []
  const order = new Map(curated.map((x, i) => [x.value, i]))
  const present = new Set<string>()
  for (const s of songs) {
    if ((s.kind ?? 'track') !== kind) continue
    for (const t of s.tags ?? []) {
      const p = parseTag(t)
      if (p.dim === dim && p.value) present.add(p.value)
    }
  }
  const all = new Set<string>([...curated.map((x) => x.value), ...present])
  return [...all]
    .sort((a, b) => {
      const ia = order.has(a) ? order.get(a)! : Infinity
      const ib = order.has(b) ? order.get(b)! : Infinity
      return ia - ib || a.localeCompare(b)
    })
    .map((value) => ({ value, label: labelForValue(dim, value) }))
}
