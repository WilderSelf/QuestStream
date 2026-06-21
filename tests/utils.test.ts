import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clamp01 } from '../src/main/bot/Mixer.ts'

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
