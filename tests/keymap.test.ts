// The single resolver for global hotkeys (src/shared/keymap.ts). Grows contexts over
// the grimoire phases (triage keys, ⌘K); this suite pins the Phase 1 contract:
// F1–F8 scene recall, D duck-hold, soundboard passthrough parity with the old
// store-inline listener, and the precedence rule that user bindings beat built-ins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveKey, type KeyContext, type KeyDescriptor } from '../src/shared/keymap.ts'

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  sceneIds: ['sc1', 'sc2', 'sc3'],
  soundboardHotkeys: [
    { key: '1', id: 'sb1' },
    { key: '2', id: 'sb2' }
  ],
  scenePadHotkeys: [],
  ...over
})

const down = (key: string, over: Partial<KeyDescriptor> = {}): KeyDescriptor => ({
  key,
  type: 'down',
  meta: false,
  ctrl: false,
  alt: false,
  repeat: false,
  typing: false,
  ...over
})

test('F1 recalls the first scene, F3 the third', () => {
  assert.deepEqual(resolveKey(down('F1'), ctx()), { kind: 'recall-scene', sceneId: 'sc1' })
  assert.deepEqual(resolveKey(down('F3'), ctx()), { kind: 'recall-scene', sceneId: 'sc3' })
})

test('an F-key with no scene at that index resolves to nothing', () => {
  assert.equal(resolveKey(down('F4'), ctx()), null)
  assert.equal(resolveKey(down('F1'), ctx({ sceneIds: [] })), null)
})

test('F9 and beyond are never scene keys', () => {
  const nine = ctx({ sceneIds: Array.from({ length: 12 }, (_, i) => `sc${i}`) })
  assert.equal(resolveKey(down('F9'), nine), null)
})

test('any key while typing in a field resolves to nothing', () => {
  assert.equal(resolveKey(down('F1', { typing: true }), ctx()), null)
  assert.equal(resolveKey(down('1', { typing: true }), ctx()), null)
  assert.equal(resolveKey(down('d', { typing: true }), ctx()), null)
})

test('modifier chords are ignored (parity with the old listener)', () => {
  assert.equal(resolveKey(down('1', { ctrl: true }), ctx()), null)
  assert.equal(resolveKey(down('F1', { meta: true }), ctx()), null)
  assert.equal(resolveKey(down('d', { alt: true }), ctx()), null)
})

test('bound soundboard keys pass through, firing on every keydown including repeats', () => {
  // Parity with the old inline listener: it never filtered e.repeat for sfx.
  assert.deepEqual(resolveKey(down('1'), ctx()), { kind: 'sfx', id: 'sb1' })
  assert.deepEqual(resolveKey(down('1', { repeat: true }), ctx()), { kind: 'sfx', id: 'sb1' })
})

test('soundboard hotkeys match e.key exactly, as before', () => {
  // The old listener compared sb.hotkey === e.key with no case folding.
  const c = ctx({ soundboardHotkeys: [{ key: 'a', id: 'sbA' }] })
  assert.deepEqual(resolveKey(down('a'), c), { kind: 'sfx', id: 'sbA' })
  assert.equal(resolveKey(down('A'), c), null)
})

test('D is duck-down on first keydown, ignored on repeat, duck-up on keyup', () => {
  assert.deepEqual(resolveKey(down('d'), ctx()), { kind: 'duck', down: true })
  assert.deepEqual(resolveKey(down('D'), ctx()), { kind: 'duck', down: true })
  assert.equal(resolveKey(down('d', { repeat: true }), ctx()), null)
  assert.deepEqual(resolveKey(down('d', { type: 'up' }), ctx()), { kind: 'duck', down: false })
})

test('a user-bound soundboard key beats the built-in duck key', () => {
  // The seeded preview data binds 'd' to a pad; user intent wins over defaults.
  const c = ctx({ soundboardHotkeys: [{ key: 'd', id: 'door' }] })
  assert.deepEqual(resolveKey(down('d'), c), { kind: 'sfx', id: 'door' })
  // ...and with the key claimed, its keyup is not a duck release either.
  assert.equal(resolveKey(down('d', { type: 'up' }), c), null)
})

test('a scene-pad hotkey beats a global soundboard binding on the same key', () => {
  const c = ctx({
    soundboardHotkeys: [{ key: '1', id: 'global' }],
    scenePadHotkeys: [{ key: '1', id: 'pad' }]
  })
  assert.deepEqual(resolveKey(down('1'), c), { kind: 'scene-pad', id: 'pad' })
})

test('keyup of non-duck keys resolves to nothing', () => {
  assert.equal(resolveKey(down('1', { type: 'up' }), ctx()), null)
  assert.equal(resolveKey(down('F1', { type: 'up' }), ctx()), null)
})

test('scene-pad trigger ids round-trip and reject malformed input', async () => {
  const { scenePadTriggerId, parseScenePadTriggerId } = await import('../src/shared/keymap.ts')
  const id = scenePadTriggerId('scene-1', 3)
  assert.deepEqual(parseScenePadTriggerId(id), { sceneId: 'scene-1', index: 3 })
  // Ordinary soundboard ids and garbage never parse as pads:
  assert.equal(parseScenePadTriggerId('sb_abc123'), null)
  assert.equal(parseScenePadTriggerId('scenepad:x'), null)
  assert.equal(parseScenePadTriggerId('scenepad:x:-1'), null)
  assert.equal(parseScenePadTriggerId('scenepad:x:1.5'), null)
})

// ---- triage key context (grimoire Phase 7) ----

const triageCtx = (inputFocused = false, inputEmpty = true): KeyContext =>
  ctx({ triage: { inputFocused, inputEmpty } })

test('in triage: Space toggles preview, Enter saves-and-advances, S skips', () => {
  assert.deepEqual(resolveKey(down(' '), triageCtx()), { kind: 'triage-preview-toggle' })
  assert.deepEqual(resolveKey(down('Enter'), triageCtx()), { kind: 'triage-save-next' })
  assert.deepEqual(resolveKey(down('s'), triageCtx()), { kind: 'triage-skip' })
  assert.deepEqual(resolveKey(down('S'), triageCtx()), { kind: 'triage-skip' })
})

test('triage keys are suppressed while the tag input has focus — except Enter on empty', () => {
  const focused = triageCtx(true, false)
  assert.equal(resolveKey(down(' ', { typing: true }), focused), null)
  assert.equal(resolveKey(down('s', { typing: true }), focused), null)
  assert.equal(resolveKey(down('Enter', { typing: true }), focused), null) // input has text
  assert.deepEqual(resolveKey(down('Enter', { typing: true }), triageCtx(true, true)), {
    kind: 'triage-save-next'
  })
})

test('in triage, F-keys and user soundboard bindings still resolve (and beat S)', () => {
  const c = ctx({
    triage: { inputFocused: false, inputEmpty: true },
    soundboardHotkeys: [{ key: 's', id: 'sfx-s' }]
  })
  assert.deepEqual(resolveKey(down('F1'), triageCtx()), { kind: 'recall-scene', sceneId: 'sc1' })
  assert.deepEqual(resolveKey(down('s'), c), { kind: 'sfx', id: 'sfx-s' })
})

test('outside triage, Space/Enter/S resolve to nothing', () => {
  assert.equal(resolveKey(down(' '), ctx()), null)
  assert.equal(resolveKey(down('Enter'), ctx()), null)
  // 's' is not bound and is not the duck key:
  assert.equal(resolveKey(down('s'), ctx()), null)
})
