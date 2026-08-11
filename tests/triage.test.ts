// Triage batch reducer (src/shared/triage.ts): audition-first tagging over a
// fixed queue of songs. Save-and-next records and advances; skip leaves the item
// untagged; carry-forward seeds the next working set from the last SAVED item
// (never from a skip); the batch ends cleanly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newTriage, reduceTriage, triageComplete } from '../src/shared/triage.ts'

const start = () => newTriage(['a', 'b', 'c'])

test('save-next records the current item and advances with its tags remembered', () => {
  let s = start()
  s = reduceTriage(s, { type: 'set-tags', tags: ['mood:tense'] })
  s = reduceTriage(s, { type: 'save-next' })
  assert.deepEqual(s.saved, [{ songId: 'a', tags: ['mood:tense'], kind: 'track' }])
  assert.equal(s.queue[s.index], 'b')
  assert.deepEqual(s.lastSavedTags, ['mood:tense'])
})

test('skip leaves the item untagged and advances', () => {
  let s = start()
  s = reduceTriage(s, { type: 'skip' })
  assert.deepEqual(s.saved, [])
  assert.deepEqual(s.skippedIds, ['a'])
  assert.equal(s.queue[s.index], 'b')
})

test('carry-forward seeds the next working set from the last SAVED item, not a skip', () => {
  let s = newTriage(['a', 'b', 'c', 'd'], { carryForward: true })
  s = reduceTriage(s, { type: 'set-tags', tags: ['genre:fantasy'] })
  s = reduceTriage(s, { type: 'save-next' })
  assert.deepEqual(s.workingTags, ['genre:fantasy']) // b seeded from a
  s = reduceTriage(s, { type: 'set-tags', tags: ['genre:fantasy', 'mood:epic'] })
  s = reduceTriage(s, { type: 'skip' }) // b skipped: its edits must NOT carry
  assert.deepEqual(s.workingTags, ['genre:fantasy']) // c seeded from last SAVED (a)
})

test('with carry-forward off, each item starts blank', () => {
  let s = start()
  s = reduceTriage(s, { type: 'set-tags', tags: ['mood:eerie'] })
  s = reduceTriage(s, { type: 'save-next' })
  assert.deepEqual(s.workingTags, [])
})

test('kind changes stick to the saved record and persist across advances', () => {
  let s = start()
  s = reduceTriage(s, { type: 'set-kind', kind: 'ambience' })
  s = reduceTriage(s, { type: 'save-next' })
  assert.equal(s.saved[0].kind, 'ambience')
  assert.equal(s.workingKind, 'ambience') // stays for the next item
})

test('the batch completes after the last item and further actions are no-ops', () => {
  let s = start()
  s = reduceTriage(s, { type: 'save-next' })
  s = reduceTriage(s, { type: 'skip' })
  assert.equal(triageComplete(s), false)
  s = reduceTriage(s, { type: 'save-next' })
  assert.equal(triageComplete(s), true)
  const after = reduceTriage(s, { type: 'save-next' })
  assert.deepEqual(after, s)
})

test('toggle-carry flips the flag without touching progress', () => {
  let s = start()
  s = reduceTriage(s, { type: 'toggle-carry' })
  assert.equal(s.carryForward, true)
  assert.equal(s.index, 0)
})
