import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  colorForTag,
  defaultColorForTag,
  DEFAULT_TAG_COLORS,
  NEUTRAL_TAG_COLOR
} from '../src/shared/tagColors.ts'

test('colorForTag resolves the per-value default', () => {
  assert.equal(colorForTag('activity:combat'), DEFAULT_TAG_COLORS.combat)
  assert.equal(colorForTag('mood:peace'), DEFAULT_TAG_COLORS.peace)
  // value-keyed, so the same value on any axis reads the same colour
  assert.equal(colorForTag('genre:fantasy'), DEFAULT_TAG_COLORS.fantasy)
})

test('colorForTag honours a user override, keyed by the normalized tag', () => {
  const overrides = { 'activity:combat': '#123456' }
  assert.equal(colorForTag('activity:combat', overrides), '#123456')
  assert.equal(colorForTag('Activity:Combat', overrides), '#123456') // normalized before lookup
  // an override for one tag does not bleed onto another
  assert.equal(colorForTag('mood:peace', overrides), DEFAULT_TAG_COLORS.peace)
})

test('colorForTag falls back to a per-dimension tint, then neutral', () => {
  // a curated dimension value with no per-value default → dimension tint (defined, not neutral)
  const cyberpunkless = colorForTag('genre:made-up-setting')
  assert.notEqual(cyberpunkless, NEUTRAL_TAG_COLOR)
  // a free tag (no dimension, no default) → neutral grey
  assert.equal(colorForTag('lofi'), NEUTRAL_TAG_COLOR)
})

test('defaultColorForTag ignores overrides', () => {
  assert.equal(defaultColorForTag('activity:combat'), DEFAULT_TAG_COLORS.combat)
})
