// Per-value colour defaults for tags, resolved by the renderer when it paints tag chips
// and Now Playing dots. Colours are seeded so the palette "reads" at a glance — combat is
// red, peaceful is blue, wilderness is green — and every default is overridable by the user
// (overrides are stored in the renderer, keyed by the normalized tag string). Pure +
// dependency-light (only parseTag/normalizeTag from taxonomy) so it imports into the
// renderer and the headless tests alike.
//
// Colours are THEME-AWARE: a tag's default (and any preset the user picks) is stored as a
// *swatch key* (e.g. 'red'), not a frozen hex. The key is resolved against the active theme's
// swatch table — the `--tag-*` CSS tokens, read back via getComputedStyle in the store — so
// recolouring the theme recolours the tags. A user who dials in a *custom* hex stores the hex
// verbatim (it starts with '#') and is therefore theme-independent by intent.

import { parseTag, normalizeTag } from './taxonomy'

export type SwatchKey =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'deepblue'
  | 'purple'

/** A concrete swatch table: swatch key → hex, plus a 'neutral' fallback. Supplied by the
 *  active theme (read from the `--tag-*` tokens); tests/headless callers use NORD_SWATCH_HEX. */
export type SwatchTable = Record<string, string>

/** The ordered swatches offered in the picker (label + the key stored / the `--tag-<key>` token). */
export const SWATCHES: { key: SwatchKey; name: string }[] = [
  { key: 'red', name: 'Red' },
  { key: 'orange', name: 'Orange' },
  { key: 'yellow', name: 'Yellow' },
  { key: 'green', name: 'Green' },
  { key: 'teal', name: 'Teal' },
  { key: 'cyan', name: 'Cyan' },
  { key: 'blue', name: 'Blue' },
  { key: 'deepblue', name: 'Deep Blue' },
  { key: 'purple', name: 'Purple' }
]

/** Default (Nord) hex for every swatch key + neutral — the fallback table when no theme has
 *  been read yet (store init before layout) and the source of truth for hex→key migration. */
export const NORD_SWATCH_HEX: SwatchTable = {
  red: '#bf616a', // nord11
  orange: '#d08770', // nord12
  yellow: '#ebcb8b', // nord13
  green: '#a3be8c', // nord14
  teal: '#8fbcbb', // nord7
  cyan: '#88c0d0', // nord8
  blue: '#81a1c1', // nord9
  deepblue: '#5e81ac', // nord10
  purple: '#b48ead', // nord15
  neutral: '#6b7280' // slate for free/uncategorised tags
}

/** Neutral slate for free/uncategorised tags with no per-value or per-dimension default. */
export const NEUTRAL_TAG_COLOR = NORD_SWATCH_HEX.neutral

/**
 * Per-VALUE defaults keyed by the value slug (dimension-agnostic: "combat" reads red
 * whether it sits on activity or a legacy axis). Values are swatch KEYS, resolved per theme.
 */
export const DEFAULT_TAG_COLORS: Record<string, SwatchKey> = {
  // activity — the "what's happening" axis carries the strongest signal
  combat: 'red',
  boss: 'red',
  chase: 'red',
  stealth: 'deepblue',
  investigation: 'purple',
  travel: 'green',
  exploration: 'green',
  social: 'yellow',
  celebration: 'yellow',
  shopping: 'orange',
  ritual: 'purple',
  downtime: 'blue',
  // mood
  tense: 'orange',
  foreboding: 'orange',
  eerie: 'purple',
  peace: 'blue',
  somber: 'deepblue',
  melancholy: 'deepblue',
  triumphant: 'yellow',
  epic: 'red',
  mysterious: 'purple',
  whimsical: 'teal',
  romantic: 'purple',
  // genre / setting
  fantasy: 'green',
  scifi: 'cyan',
  cyberpunk: 'purple',
  horror: 'red',
  modern: 'blue',
  historical: 'orange',
  western: 'orange',
  steampunk: 'orange',
  'post-apocalyptic': 'red',
  // location (cooler, environmental)
  tavern: 'orange',
  town: 'yellow',
  market: 'yellow',
  woods: 'green',
  wilderness: 'green',
  camp: 'green',
  docks: 'cyan',
  ship: 'cyan',
  dungeon: 'deepblue',
  cave: 'deepblue',
  underground: 'deepblue',
  castle: 'blue',
  temple: 'teal',
  swamp: 'green',
  desert: 'orange',
  mountains: 'blue',
  graveyard: 'purple'
}

/** Per-dimension swatch key used when a value has no specific default (keeps whole axes coherent). */
const DIMENSION_COLORS: Record<string, SwatchKey> = {
  genre: 'teal',
  location: 'cyan',
  mood: 'purple',
  activity: 'red'
}

/** Resolve a stored value (a swatch key, or a raw '#hex') to a concrete colour via the table. */
function resolveSwatch(value: string | undefined, swatches: SwatchTable): string | undefined {
  if (!value) return undefined
  if (value.startsWith('#')) return value // custom hex — theme-independent by intent
  return swatches[value] ?? NORD_SWATCH_HEX[value]
}

/**
 * Resolve a tag's colour to a concrete hex: user override (keyed by the normalized tag) →
 * per-value default → per-dimension tint → neutral. `swatches` is the active theme's table
 * (defaults to Nord for headless/test callers). Never throws.
 */
export function colorForTag(
  tag: string,
  overrides?: Record<string, string>,
  swatches: SwatchTable = NORD_SWATCH_HEX
): string {
  const norm = normalizeTag(tag)
  const { dim, value } = parseTag(norm)
  const key =
    overrides?.[norm] ?? DEFAULT_TAG_COLORS[value] ?? (dim ? DIMENSION_COLORS[dim] : undefined)
  return resolveSwatch(key, swatches) ?? swatches.neutral ?? NORD_SWATCH_HEX.neutral
}

/** The default colour for a tag, ignoring user overrides (for the picker's "Reset"). */
export function defaultColorForTag(tag: string, swatches: SwatchTable = NORD_SWATCH_HEX): string {
  return colorForTag(tag, undefined, swatches)
}

/** Reverse of NORD_SWATCH_HEX (excluding neutral, which isn't a pickable swatch). */
const HEX_TO_KEY: Record<string, SwatchKey> = Object.fromEntries(
  SWATCHES.map((s) => [NORD_SWATCH_HEX[s.key].toLowerCase(), s.key])
) as Record<string, SwatchKey>

/**
 * Migrate a persisted override to the theme-aware model: a legacy raw hex that exactly matches
 * a Nord swatch becomes that swatch key (so it now follows the theme); a custom hex is kept
 * verbatim; an already-migrated key passes through unchanged. Idempotent.
 */
export function migrateTagColor(value: string): string {
  if (!value.startsWith('#')) return value // already a swatch key
  return HEX_TO_KEY[value.toLowerCase()] ?? value // custom hex kept as-is
}
