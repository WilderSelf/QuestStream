// Pure next-track policy (src/shared/queue-policy.ts). The first block pins exact
// parity with the old inline playNext branches; the second pins the new per-scene
// end-of-list behaviors. RNG is injected for determinism.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextQueueIndex, type NextTrackState } from '../src/shared/queue-policy.ts'

const st = (over: Partial<NextTrackState> = {}): NextTrackState => ({
  index: 0,
  length: 3,
  shuffle: false,
  repeat: 'off',
  trackLoop: 'off',
  auto: false,
  ...over
})

const rand0 = (): number => 0 // always the first candidate

test('legacy parity: per-track loop-on replays forever on natural end only', () => {
  assert.deepEqual(nextQueueIndex(st({ auto: true, trackLoop: 'on' }), rand0), { kind: 'replay' })
  // manual next ignores the track loop
  assert.deepEqual(nextQueueIndex(st({ auto: false, trackLoop: 'on' }), rand0), { kind: 'index', index: 1 })
})

test('legacy parity: loop-once replays and is consumed', () => {
  assert.deepEqual(nextQueueIndex(st({ auto: true, trackLoop: 'once' }), rand0), {
    kind: 'replay',
    consumeTrackLoop: true
  })
})

test('legacy parity: repeat-one only on natural end, and only with a current track', () => {
  assert.deepEqual(nextQueueIndex(st({ auto: true, repeat: 'one' }), rand0), { kind: 'replay' })
  assert.deepEqual(nextQueueIndex(st({ auto: false, repeat: 'one' }), rand0), { kind: 'index', index: 1 })
  assert.deepEqual(nextQueueIndex(st({ auto: true, repeat: 'one', index: -1 }), rand0), {
    kind: 'index',
    index: 0
  })
})

test('legacy parity: shuffle avoids the current track when it can', () => {
  const d = nextQueueIndex(st({ shuffle: true, index: 0 }), rand0)
  assert.deepEqual(d, { kind: 'index', index: 1 }) // rand0 → first non-current candidate
  // single-track queue: the only candidate is the current track itself
  assert.deepEqual(nextQueueIndex(st({ shuffle: true, index: 0, length: 1 }), rand0), {
    kind: 'index',
    index: 0
  })
})

test('legacy parity: sequential next; repeat-all wraps; otherwise stop', () => {
  assert.deepEqual(nextQueueIndex(st({ index: 1 }), rand0), { kind: 'index', index: 2 })
  assert.deepEqual(nextQueueIndex(st({ index: 2, repeat: 'all' }), rand0), { kind: 'index', index: 0 })
  assert.deepEqual(nextQueueIndex(st({ index: 2 }), rand0), { kind: 'stop' })
})

test('legacy parity: no current track advances into the top of the queue', () => {
  assert.deepEqual(nextQueueIndex(st({ index: -1 }), rand0), { kind: 'index', index: 0 })
})

test('empty queue always stops', () => {
  assert.deepEqual(nextQueueIndex(st({ length: 0 }), rand0), { kind: 'stop' })
})

test('endOfList loop-list starts the list over at the tail', () => {
  assert.deepEqual(nextQueueIndex(st({ index: 2, endOfList: 'loop-list' }), rand0), {
    kind: 'index',
    index: 0
  })
})

test('endOfList loop-last keeps replaying the final track', () => {
  assert.deepEqual(nextQueueIndex(st({ index: 2, endOfList: 'loop-last' }), rand0), { kind: 'replay' })
})

test('endOfList shuffle keeps drawing from the list at the tail', () => {
  assert.deepEqual(nextQueueIndex(st({ index: 2, endOfList: 'shuffle' }), rand0), {
    kind: 'index',
    index: 0
  })
})

test('endOfList stop silences even under global repeat-all', () => {
  assert.deepEqual(nextQueueIndex(st({ index: 2, repeat: 'all', endOfList: 'stop' }), rand0), {
    kind: 'stop'
  })
})

test('endOfList only governs the tail — mid-list playback is untouched', () => {
  assert.deepEqual(nextQueueIndex(st({ index: 0, endOfList: 'loop-last' }), rand0), {
    kind: 'index',
    index: 1
  })
})
