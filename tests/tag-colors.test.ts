import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  colorForTag,
  defaultColorForTag,
  migrateTagColor,
  DEFAULT_TAG_COLORS,
  NORD_SWATCH_HEX,
  NEUTRAL_TAG_COLOR
} from '../src/shared/tagColors.ts'

const hex = (key: string): string => NORD_SWATCH_HEX[key]

test('colorForTag resolves the per-value default to a concrete hex (default Nord table)', () => {
  assert.equal(colorForTag('activity:combat'), hex(DEFAULT_TAG_COLORS.combat))
  assert.equal(colorForTag('mood:peace'), hex(DEFAULT_TAG_COLORS.peace))
  // value-keyed, so the same value on any axis reads the same colour
  assert.equal(colorForTag('genre:fantasy'), hex(DEFAULT_TAG_COLORS.fantasy))
})

test('colorForTag resolves swatch keys against the supplied theme table', () => {
  const theme = { ...NORD_SWATCH_HEX, red: '#ff0000', blue: '#0000ff' }
  assert.equal(colorForTag('activity:combat', undefined, theme), '#ff0000') // combat → 'red'
  assert.equal(colorForTag('mood:peace', undefined, theme), '#0000ff') // peace → 'blue'
})

test('colorForTag honours a user override — swatch key or custom hex', () => {
  // a swatch-key override resolves through the active table (follows the theme)
  assert.equal(colorForTag('activity:combat', { 'activity:combat': 'green' }), hex('green'))
  // a custom-hex override is theme-independent and returned verbatim
  const custom = { 'activity:combat': '#123456' }
  assert.equal(colorForTag('activity:combat', custom), '#123456')
  assert.equal(colorForTag('Activity:Combat', custom), '#123456') // normalized before lookup
  // an override for one tag does not bleed onto another
  assert.equal(colorForTag('mood:peace', custom), hex(DEFAULT_TAG_COLORS.peace))
})

test('colorForTag falls back to a per-dimension tint, then neutral', () => {
  // a curated dimension value with no per-value default → dimension tint (defined, not neutral)
  const cyberpunkless = colorForTag('genre:made-up-setting')
  assert.notEqual(cyberpunkless, NEUTRAL_TAG_COLOR)
  // a free tag (no dimension, no default) → neutral grey
  assert.equal(colorForTag('lofi'), NEUTRAL_TAG_COLOR)
})

test('defaultColorForTag ignores overrides', () => {
  assert.equal(defaultColorForTag('activity:combat'), hex(DEFAULT_TAG_COLORS.combat))
})

test('migrateTagColor maps legacy Nord hex → swatch key, keeps custom hex and existing keys', () => {
  assert.equal(migrateTagColor(NORD_SWATCH_HEX.red), 'red') // legacy preset now follows the theme
  assert.equal(migrateTagColor('#BF616A'), 'red') // case-insensitive
  assert.equal(migrateTagColor('#123456'), '#123456') // custom hex kept as-is
  assert.equal(migrateTagColor('purple'), 'purple') // already a key — idempotent
})
