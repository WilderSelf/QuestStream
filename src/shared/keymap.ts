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
}

export interface HotkeyBinding {
  /** Matched against e.key exactly — no case folding (parity with the old listener). */
  key: string
  id: string
}

export interface KeyContext {
  /** Scenes in rail order; F1–F8 recall the first eight. */
  sceneIds: string[]
  soundboardHotkeys: HotkeyBinding[]
  /** Pads of the on-air scene; empty until Phase 5 wires them. */
  scenePadHotkeys: HotkeyBinding[]
}

export type KeyAction =
  | { kind: 'recall-scene'; sceneId: string }
  | { kind: 'sfx'; id: string }
  | { kind: 'scene-pad'; id: string }
  | { kind: 'duck'; down: boolean }

const SCENE_KEY_COUNT = 8
const DUCK_KEY = 'd'

export function resolveKey(k: KeyDescriptor, ctx: KeyContext): KeyAction | null {
  if (k.typing) return null
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
