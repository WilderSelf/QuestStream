import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickNextDelay, pickFromPool } from '../src/main/bot/random.ts'

test('pickNextDelay stays within [min,max] seconds (as ms)', () => {
  for (const r of [0, 0.25, 0.5, 0.99, 1]) {
    const ms = pickNextDelay(10, 30, () => r)
    assert.ok(ms >= 10_000 && ms <= 30_000, `${ms} out of range`)
  }
})

test('pickNextDelay clamps to >=1s and min<=max', () => {
  assert.equal(pickNextDelay(0, 0, () => 0.5), 1000) // floor at 1s
  // inverted range: hi is clamped up to lo, so result is exactly lo
  assert.equal(pickNextDelay(30, 5, () => 0.5), 30_000)
})

test('pickNextDelay tolerates non-finite input', () => {
  const ms = pickNextDelay(NaN, Infinity, () => 0.5)
  assert.ok(Number.isFinite(ms) && ms >= 1000)
})

test('pickFromPool returns a member, or null when empty', () => {
  assert.equal(pickFromPool([], () => 0.5), null)
  assert.equal(pickFromPool(undefined, () => 0.5), null)
  assert.equal(pickFromPool(['a', 'b', 'c'], () => 0), 'a')
  assert.equal(pickFromPool(['a', 'b', 'c'], () => 0.99), 'c')
})
