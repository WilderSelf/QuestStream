// Per-value colour defaults for tags, resolved by the renderer when it paints tag chips
// and Now Playing dots. Colours are seeded so the palette "reads" at a glance — combat is
// red, peaceful is blue, wilderness is green — and every default is overridable by the user
// (overrides are stored in the renderer, keyed by the normalized tag string). Pure +
// dependency-light (only parseTag/normalizeTag from taxonomy) so it imports into the
// renderer and the headless tests alike.

import { parseTag, normalizeTag } from './taxonomy'

/** The Nord aurora/frost swatches we draw tag colours from (mirrors --nordN in styles.css). */
export const NORD_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Red', hex: '#bf616a' }, // nord11
  { name: 'Orange', hex: '#d08770' }, // nord12
  { name: 'Yellow', hex: '#ebcb8b' }, // nord13
  { name: 'Green', hex: '#a3be8c' }, // nord14
  { name: 'Teal', hex: '#8fbcbb' }, // nord7
  { name: 'Cyan', hex: '#88c0d0' }, // nord8
  { name: 'Blue', hex: '#81a1c1' }, // nord9
  { name: 'Deep Blue', hex: '#5e81ac' }, // nord10
  { name: 'Purple', hex: '#b48ead' } // nord15
]

const C = Object.fromEntries(NORD_SWATCHES.map((s) => [s.name.replace(/\s+/g, '').toLowerCase(), s.hex])) as Record<
  string,
  string
>

/** Neutral slate for free/uncategorised tags with no per-value or per-dimension default. */
export const NEUTRAL_TAG_COLOR = '#6b7280'

/**
 * Per-VALUE defaults keyed by the value slug (dimension-agnostic: "combat" reads red
 * whether it sits on activity or a legacy axis). Chosen to feel like the thing they name.
 */
export const DEFAULT_TAG_COLORS: Record<string, string> = {
  // activity — the "what's happening" axis carries the strongest signal
  combat: C.red,
  boss: C.red,
  chase: C.red,
  stealth: C.deepblue,
  investigation: C.purple,
  travel: C.green,
  exploration: C.green,
  social: C.yellow,
  celebration: C.yellow,
  shopping: C.orange,
  ritual: C.purple,
  downtime: C.blue,
  // mood
  tense: C.orange,
  foreboding: C.orange,
  eerie: C.purple,
  peace: C.blue,
  somber: C.deepblue,
  melancholy: C.deepblue,
  triumphant: C.yellow,
  epic: C.red,
  mysterious: C.purple,
  whimsical: C.teal,
  romantic: C.purple,
  // genre / setting
  fantasy: C.green,
  scifi: C.cyan,
  cyberpunk: C.purple,
  horror: C.red,
  modern: C.blue,
  historical: C.orange,
  western: C.orange,
  steampunk: C.orange,
  'post-apocalyptic': C.red,
  // location (cooler, environmental)
  tavern: C.orange,
  town: C.yellow,
  market: C.yellow,
  woods: C.green,
  wilderness: C.green,
  camp: C.green,
  docks: C.cyan,
  ship: C.cyan,
  dungeon: C.deepblue,
  cave: C.deepblue,
  underground: C.deepblue,
  castle: C.blue,
  temple: C.teal,
  swamp: C.green,
  desert: C.orange,
  mountains: C.blue,
  graveyard: C.purple
}

/** Per-dimension tint used when a value has no specific default (keeps whole axes coherent). */
const DIMENSION_COLORS: Record<string, string> = {
  genre: C.teal,
  location: C.cyan,
  mood: C.purple,
  activity: C.red
}

/**
 * Resolve a tag's colour: user override (keyed by the normalized tag) → per-value default
 * → per-dimension tint → neutral grey. Never throws; unknown tags get the neutral colour.
 */
export function colorForTag(tag: string, overrides?: Record<string, string>): string {
  const norm = normalizeTag(tag)
  const { dim, value } = parseTag(norm)
  return (
    overrides?.[norm] ??
    DEFAULT_TAG_COLORS[value] ??
    (dim ? DIMENSION_COLORS[dim] : undefined) ??
    NEUTRAL_TAG_COLOR
  )
}

/** The default colour for a tag, ignoring user overrides (for the picker's "Reset"). */
export function defaultColorForTag(tag: string): string {
  return colorForTag(tag, undefined)
}
