// Pure scene-draft reducer (src/shared/scene-edit.ts): the editable working copy of a
// Scene document. Pins immutability, index bookkeeping, the copy-live-mix mapping (must
// match the renderer's saveScene snapshot convention), and dirty tracking.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Scene } from '../src/shared/types.ts'
import {
  newDraft,
  reduceDraft,
  draftToSceneInput,
  isDirty,
  DEFAULT_LAYER_MIN_SEC,
  DEFAULT_LAYER_MAX_SEC,
  type SceneDraft
} from '../src/shared/scene-edit.ts'

const scene = (over: Partial<Scene> = {}): Scene => ({
  id: 'sc1',
  name: 'Quiet Tavern',
  songIds: ['s1', 's2'],
  musicVolume: 0.8,
  currentIndex: 1,
  ambience: [{ songId: 'a1', volume: 0.5, playing: true }],
  createdAt: 1,
  updatedAt: 2,
  ...over
})

const draftWith = (songIds: string[], currentIndex = 0): SceneDraft => ({
  ...newDraft(),
  songIds,
  currentIndex
})

test('newDraft() is blank and not dirty; newDraft(scene) copies the document', () => {
  const blank = newDraft()
  assert.equal(blank.name, '')
  assert.equal(isDirty(blank), false)

  const d = newDraft(scene({ note: 'n', crossfadeMs: 4000 }))
  assert.equal(d.sceneId, 'sc1')
  assert.equal(d.note, 'n')
  assert.equal(d.crossfadeMs, 4000)
  // legacy layer defaults filled in for editing
  assert.equal(d.ambience[0].mode, 'loop')
  assert.equal(d.ambience[0].minIntervalSec, DEFAULT_LAYER_MIN_SEC)
  assert.equal(d.ambience[0].maxIntervalSec, DEFAULT_LAYER_MAX_SEC)
})

test('a legacy multi-song pool expands to one layer per pool entry', () => {
  const d = newDraft(
    scene({ ambience: [{ songId: 'a1', volume: 0.4, playing: true, pool: ['a1', 'a2'] }] })
  )
  assert.equal(d.ambience.length, 2)
  assert.deepEqual(d.ambience.map((l) => l.songId), ['a1', 'a2'])
})

test('reduceDraft never mutates its input', () => {
  const before = newDraft(scene())
  const frozen = JSON.stringify(before)
  reduceDraft(before, { type: 'set-name', name: 'X' })
  reduceDraft(before, { type: 'add-song', songId: 's9' })
  reduceDraft(before, { type: 'remove-song', index: 0 })
  reduceDraft(before, { type: 'set-layer-volume', index: 0, volume: 0.1 })
  assert.equal(JSON.stringify(before), frozen)
})

test('add-song before the start marker shifts it; remove-song adjusts and clamps it', () => {
  let d = draftWith(['s1', 's2'], 1)
  d = reduceDraft(d, { type: 'add-song', songId: 's0', index: 0 })
  assert.deepEqual(d.songIds, ['s0', 's1', 's2'])
  assert.equal(d.currentIndex, 2)
  d = reduceDraft(d, { type: 'remove-song', index: 0 })
  assert.equal(d.currentIndex, 1)
  d = reduceDraft(d, { type: 'remove-song', index: 1 })
  assert.equal(d.currentIndex, 0, 'clamped into the shrunk list')
})

test('move-song keeps the start marker on the same song', () => {
  let d = draftWith(['a', 'b', 'c'], 1) // start = b
  d = reduceDraft(d, { type: 'move-song', from: 1, to: 2 })
  assert.deepEqual(d.songIds, ['a', 'c', 'b'])
  assert.equal(d.songIds[d.currentIndex], 'b')
  d = reduceDraft(d, { type: 'move-song', from: 0, to: 2 }) // move 'a' past 'b'
  assert.equal(d.songIds[d.currentIndex], 'b')
})

test('layer edits: volume clamps, interval floors at 1 and keeps max >= min', () => {
  let d = reduceDraft(newDraft(), { type: 'add-layer', songId: 'amb' })
  d = reduceDraft(d, { type: 'set-layer-volume', index: 0, volume: 1.7 })
  assert.equal(d.ambience[0].volume, 1)
  d = reduceDraft(d, { type: 'set-layer-interval', index: 0, minSec: 0, maxSec: -5 })
  assert.equal(d.ambience[0].minIntervalSec, 1)
  assert.equal(d.ambience[0].maxIntervalSec, 1)
  d = reduceDraft(d, { type: 'set-layer-mode', index: 0, mode: 'random' })
  assert.equal(d.ambience[0].mode, 'random')
})

test('pads: add, patch, remove', () => {
  let d = reduceDraft(newDraft(), { type: 'add-pad', pad: { songId: 'x1', hotkey: '1' } })
  d = reduceDraft(d, { type: 'set-pad', index: 0, patch: { gain: 0.6, duckUnderMusic: true } })
  assert.deepEqual(d.pads[0], { songId: 'x1', hotkey: '1', gain: 0.6, duckUnderMusic: true })
  d = reduceDraft(d, { type: 'remove-pad', index: 0 })
  assert.equal(d.pads.length, 0)
})

test('copy-live-mix replaces music + layers but keeps name/note/pads', () => {
  let d = reduceDraft(newDraft(), { type: 'set-name', name: 'Keep' })
  d = reduceDraft(d, { type: 'add-pad', pad: { songId: 'p1' } })
  d = reduceDraft(d, {
    type: 'copy-live-mix',
    snapshot: {
      songIds: ['s1', 's2'],
      currentIndex: 1,
      musicVolume: 0.7,
      layers: [
        { songId: 'a1', volume: 0.5, playing: true, mode: 'loop', minIntervalSec: 20, maxIntervalSec: 60 }
      ]
    }
  })
  assert.equal(d.name, 'Keep')
  assert.equal(d.pads.length, 1)
  assert.deepEqual(d.songIds, ['s1', 's2'])
  assert.equal(d.musicVolume, 0.7)
  assert.equal(d.ambience[0].songId, 'a1')
})

test('draftToSceneInput mirrors the saveScene snapshot convention', () => {
  const input = draftToSceneInput(newDraft(scene({ note: 'n', crossfadeMs: 2000 })))
  assert.equal(input.id, 'sc1')
  assert.equal(input.name, 'Quiet Tavern')
  // single-song pool kept for back-compat, exactly like the live snapshot path
  assert.deepEqual(input.ambience[0].pool, ['a1'])
  assert.equal(input.ambience[0].minIntervalSec, DEFAULT_LAYER_MIN_SEC)
  assert.equal(input.note, 'n')
  assert.equal(input.crossfadeMs, 2000)
  assert.ok(!('pads' in input), 'empty pads omitted from the payload')
})

test('empty name saves as Untitled Scene', () => {
  assert.equal(draftToSceneInput(newDraft()).name, 'Untitled Scene')
})

test('isDirty: false after a no-op edit round-trip, true after a real change', () => {
  const s = scene()
  const d = newDraft(s)
  assert.equal(isDirty(d, s), false)
  const renamed = reduceDraft(d, { type: 'set-name', name: 'Loud Tavern' })
  assert.equal(isDirty(renamed, s), true)
  const blankPlus = reduceDraft(newDraft(), { type: 'add-song', songId: 's1' })
  assert.equal(isDirty(blankPlus), true)
})
