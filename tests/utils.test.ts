import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clamp01 } from '../src/main/bot/Mixer.ts'
import { clampNum } from '../src/shared/num.ts'

test('clamp01 bounds to [0,1]', () => {
  assert.equal(clamp01(0.5), 0.5)
  assert.equal(clamp01(2), 1)
  assert.equal(clamp01(-1), 0)
  assert.equal(clamp01(0), 0)
  assert.equal(clamp01(1), 1)
})

test('clamp01 is NaN/Infinity-safe (SEC7)', () => {
  assert.equal(clamp01(NaN), 0)
  assert.equal(clamp01(Infinity), 0)
  assert.equal(clamp01(-Infinity), 0)
  assert.equal(clamp01(parseFloat('')), 0) // empty slider input → NaN → 0
})

test('clampNum bounds to [lo,hi] and falls back to lo on non-numbers', () => {
  assert.equal(clampNum(5, 0, 10), 5)
  assert.equal(clampNum(-3, 0, 10), 0)
  assert.equal(clampNum(99, 0, 10), 10)
  // Untrusted remote input: non-finite or non-number coerces to lo, never poisons downstream.
  assert.equal(clampNum(NaN, 0, 1), 0)
  assert.equal(clampNum('0.5', 0, 1), 0)
  assert.equal(clampNum(undefined, 2, 8), 2)
})
