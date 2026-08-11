/**
 * The single resolver for global hotkeys. The renderer's window keydown/keyup listener
 * builds a KeyDescriptor + KeyContext and dispatches on the returned action; nothing
 * else in the app interprets raw key events. Grows per-workspace contexts in later
 * grimoire phases (triage keys, the ⌘K seeker) — add rules here, pin them in
 * tests/keymap.test.ts, and every surface stays consistent.
 *
 * Precedence (user intent beats built-ins):
 *   scene-pad hotkeys > soundboard hotkeys > built-ins (F1–F8 recall, D duck-hold).
 * A user binding on a built-in key fully claims it, including its keyup.
 */

export interface KeyDescriptor {
  key: string
  type: 'down' | 'up'
  meta: boolean
  ctrl: boolean
  alt: boolean
  repeat: boolean
  /** True when focus is in an input/textarea/select or a capture flow (hotkey binding). */
  typing: boolean
  /** True mid-IME-composition (KeyboardEvent.isComposing) — global keys must not fire. */
  composing?: boolean
}

export interface HotkeyBinding {
  /** Matched against e.key exactly — no case folding (parity with the old listener). */
  key: string
  id: string
}

/** Present while the tag-triage workspace is active (Phase 7). */
export interface TriageKeys {
  inputFocused: boolean
  /** True when the tag type-ahead input is empty — Enter then means save-and-next. */
  inputEmpty: boolean
}

export interface KeyContext {
  /** Scenes in rail order; F1–F8 recall the first eight. */
  sceneIds: string[]
  soundboardHotkeys: HotkeyBinding[]
  /** Pads of the on-air scene; empty until Phase 5 wires them. */
  scenePadHotkeys: HotkeyBinding[]
  triage?: TriageKeys
  /** True while the ⌘K seeker overlay is open (Escape then closes it). */
  seekerOpen?: boolean
}

export type KeyAction =
  | { kind: 'recall-scene'; sceneId: string }
  | { kind: 'sfx'; id: string }
  | { kind: 'scene-pad'; id: string }
  | { kind: 'duck'; down: boolean }
  | { kind: 'triage-preview-toggle' }
  | { kind: 'triage-save-next' }
  | { kind: 'triage-skip' }
  | { kind: 'seeker-open' }
  | { kind: 'seeker-close' }

const SCENE_KEY_COUNT = 8
const DUCK_KEY = 'd'

/**
 * Scene pads have no ids of their own (they live as an array on the scene), so a
 * pad trigger travels as `scenepad:<sceneId>:<index>` through the same
 * soundboard:trigger channel. The main handler parses it back with the twin below.
 */
const SCENE_PAD_PREFIX = 'scenepad:'

export function scenePadTriggerId(sceneId: string, index: number): string {
  return `${SCENE_PAD_PREFIX}${sceneId}:${index}`
}

export function parseScenePadTriggerId(id: string): { sceneId: string; index: number } | null {
  if (!id.startsWith(SCENE_PAD_PREFIX)) return null
  const rest = id.slice(SCENE_PAD_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return null
  const sceneId = rest.slice(0, sep)
  const rawIndex = rest.slice(sep + 1)
  if (!/^\d+$/.test(rawIndex)) return null
  return { sceneId, index: Number(rawIndex) }
}

export function resolveKey(k: KeyDescriptor, ctx: KeyContext): KeyAction | null {
  // The seeker keys outrank everything — reachable from any field — but never
  // mid-IME-composition (the keystroke belongs to the composer).
  if (k.type === 'down' && !k.composing) {
    if (k.key.toLowerCase() === 'k' && (k.meta || k.ctrl) && !k.alt) {
      return { kind: 'seeker-open' }
    }
    if (k.key === 'Escape' && ctx.seekerOpen) return { kind: 'seeker-close' }
  }
  if (k.typing) {
    // The one deliberate exception: in triage, Enter on an EMPTY tag input means
    // "save & next" — an empty field has nothing else Enter could mean.
    if (ctx.triage && k.type === 'down' && k.key === 'Enter' && ctx.triage.inputEmpty) {
      return { kind: 'triage-save-next' }
    }
    return null
  }
  if (k.meta || k.ctrl || k.alt) return null

  const pad = ctx.scenePadHotkeys.find((b) => b.key === k.key)
  const sfx = pad ? undefined : ctx.soundboardHotkeys.find((b) => b.key === k.key)

  if (k.type === 'up') {
    // A user binding on the duck key claims its keyup too — no phantom release.
    if (k.key.toLowerCase() === DUCK_KEY && !pad && !sfx) return { kind: 'duck', down: false }
    return null
  }

  if (pad) return { kind: 'scene-pad', id: pad.id }
  if (sfx) return { kind: 'sfx', id: sfx.id }

  // Triage built-ins (after user bindings — a soundboard key on 's' wins).
  if (ctx.triage) {
    if (k.key === ' ') return { kind: 'triage-preview-toggle' }
    if (k.key === 'Enter') return { kind: 'triage-save-next' }
    if (k.key.toLowerCase() === 's') return { kind: 'triage-skip' }
  }

  const fMatch = /^F([1-8])$/.exec(k.key)
  if (fMatch) {
    const sceneId = ctx.sceneIds[Number(fMatch[1]) - 1]
    return sceneId ? { kind: 'recall-scene', sceneId } : null
  }

  if (k.key.toLowerCase() === DUCK_KEY) {
    return k.repeat ? null : { kind: 'duck', down: true }
  }

  return null
}
