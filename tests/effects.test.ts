import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAfChain, EFFECTS } from '../src/main/bot/effects.ts'
import { EFFECT_PRESETS } from '../src/shared/effects.ts'

const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11'

test('buildAfChain with no effect is loudnorm only (unchanged legacy behaviour)', () => {
  assert.equal(buildAfChain(), LOUDNORM)
  assert.equal(buildAfChain(''), LOUDNORM)
  assert.equal(buildAfChain('not-a-real-effect'), LOUDNORM)
})

test('buildAfChain ignores Object.prototype keys (no inherited-member leak into -af)', () => {
  // A malicious pack could set `effect` to an inherited member name; the lookup must
  // not stringify that member into the ffmpeg argument. (SEC: own-key lookup only.)
  for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
    assert.equal(buildAfChain(key), LOUDNORM)
  }
})

test('buildAfChain appends a known preset after loudnorm', () => {
  for (const key of Object.keys(EFFECTS)) {
    assert.equal(buildAfChain(key), `${LOUDNORM},${EFFECTS[key]}`)
  }
})

test('loudnorm always comes first in the chain', () => {
  for (const key of Object.keys(EFFECTS)) {
    assert.ok(buildAfChain(key).startsWith(LOUDNORM + ','))
  }
})

test('EFFECTS (main) and EFFECT_PRESETS (shared) keys stay in sync', () => {
  const main = Object.keys(EFFECTS).sort()
  const shared = EFFECT_PRESETS.map((p) => p.key).sort()
  assert.deepEqual(shared, main)
})
