import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand, validatePairing, RateBucket } from '../src/main/remote/server.ts'

test('parseCommand accepts known simple actions', () => {
  for (const action of ['togglePlay', 'pause', 'resume', 'next', 'prev']) {
    assert.deepEqual(parseCommand({ action }), { action })
  }
})

test('parseCommand clamps numeric args', () => {
  assert.deepEqual(parseCommand({ action: 'setVolume', volume: 5 }), { action: 'setVolume', volume: 1 })
  assert.deepEqual(parseCommand({ action: 'setVolume', volume: -1 }), { action: 'setVolume', volume: 0 })
  assert.deepEqual(parseCommand({ action: 'seek', seconds: -10 }), { action: 'seek', seconds: 0 })
  // non-finite → clamped to the low bound
  assert.deepEqual(parseCommand({ action: 'setVolume', volume: 'x' }), { action: 'setVolume', volume: 0 })
})

test('parseCommand requires ids for id-bearing actions', () => {
  assert.equal(parseCommand({ action: 'recallScene' }), null)
  assert.deepEqual(parseCommand({ action: 'recallScene', id: 's1' }), { action: 'recallScene', id: 's1' })
  assert.deepEqual(parseCommand({ action: 'triggerSfx', id: 'x' }), { action: 'triggerSfx', id: 'x' })
  assert.deepEqual(parseCommand({ action: 'playQueueItem', uid: 'q1' }), { action: 'playQueueItem', uid: 'q1' })
})

test('parseCommand rejects junk', () => {
  assert.equal(parseCommand(null), null)
  assert.equal(parseCommand({}), null)
  assert.equal(parseCommand({ action: 'rm -rf' }), null)
  assert.equal(parseCommand('nope'), null)
})

test('validatePairing accepts a fresh matching code only', () => {
  const state = { code: 'abc', expires: 1000, used: false }
  assert.equal(validatePairing(state, 'abc', 500), true)
  assert.equal(validatePairing(state, 'wrong', 500), false)
  assert.equal(validatePairing(null, 'abc', 500), false)
})

test('validatePairing rejects expired and already-used codes', () => {
  assert.equal(validatePairing({ code: 'abc', expires: 1000, used: false }, 'abc', 1001), false) // expired
  assert.equal(validatePairing({ code: 'abc', expires: 1000, used: true }, 'abc', 500), false) // used
})

test('RateBucket allows a burst, blocks, then refills', () => {
  const b = new RateBucket(3, 1, 0) // capacity 3, 1 token/sec
  assert.equal(b.take(0), true)
  assert.equal(b.take(0), true)
  assert.equal(b.take(0), true)
  assert.equal(b.take(0), false) // burst exhausted
  assert.equal(b.take(1000), true) // ~1s later → 1 refilled
  assert.equal(b.take(1000), false)
})
