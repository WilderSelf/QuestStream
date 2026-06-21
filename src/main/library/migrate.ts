import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync, cpSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

/**
 * The only profile directory names we'll seed FROM — the app's own prior names across its
 * renames. Scanning every sibling under `~/.config` would let an unrelated (or planted) dir
 * with a high song count and a crafted config.json seed our profile; this keeps the trust
 * surface to known-ours directories. Matched case-insensitively.
 */
const LEGACY_PROFILE_NAMES = new Set(['kenku-clone', 'kenku clone', 'queststream'])

/** A sibling profile dir looks like ours if its library.json has the expected arrays. */
function libraryShape(path: string): { songs: number } | null {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (Array.isArray(j.songs) && Array.isArray(j.artists) && Array.isArray(j.albums)) {
      return { songs: j.songs.length }
    }
  } catch {
    // unreadable / corrupt / not ours
  }
  return null
}

/**
 * One-time, non-destructive recovery for the app having been renamed over its life
 * (kenku-clone → queststream → QuestStream). Each rename moved Electron's `userData`
 * to a new sibling directory, stranding the previous library — which looks to the user
 * like "all my tracks vanished" (an empty Music pane on first launch after a rename).
 *
 * If THIS profile has no `library.json` yet, seed it from the most-populated sibling
 * profile — copying the library, the config (Discord/remote tokens) and the
 * content-addressed media dir so local-file songs still resolve. It only ever writes
 * when the current profile is empty, so it can never clobber real data and is a no-op
 * on every subsequent launch. Returns the source profile name, or null if nothing seeded.
 */
export function seedFromLegacyProfile(userData: string): string | null {
  const target = join(userData, 'library.json')
  if (existsSync(target)) return null // this profile already has data — never overwrite

  const parent = dirname(userData)
  const self = basename(userData)
  let entries: string[]
  try {
    entries = readdirSync(parent)
  } catch {
    return null
  }

  let best: { dir: string; songs: number } | null = null
  for (const name of entries) {
    if (name === self) continue
    if (!LEGACY_PROFILE_NAMES.has(name.toLowerCase())) continue // only seed from known prior names
    const lib = join(parent, name, 'library.json')
    if (!existsSync(lib)) continue
    const shape = libraryShape(lib)
    if (shape && shape.songs > 0 && (!best || shape.songs > best.songs)) {
      best = { dir: name, songs: shape.songs }
    }
  }
  if (!best) return null

  const srcDir = join(parent, best.dir)
  try {
    mkdirSync(userData, { recursive: true })
    copyFileSync(join(srcDir, 'library.json'), target)
    const srcCfg = join(srcDir, 'config.json')
    if (existsSync(srcCfg) && !existsSync(join(userData, 'config.json'))) {
      copyFileSync(srcCfg, join(userData, 'config.json'))
    }
    const srcMedia = join(srcDir, 'media')
    if (existsSync(srcMedia) && !existsSync(join(userData, 'media'))) {
      cpSync(srcMedia, join(userData, 'media'), { recursive: true })
    }
    console.log(`[migrate] seeded profile "${self}" from legacy "${best.dir}" (${best.songs} songs)`)
    return best.dir
  } catch (err) {
    console.error('[migrate] failed to seed from legacy profile:', err)
    return null
  }
}
