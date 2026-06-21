import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTag,
  makeTag,
  normalizeTag,
  defaultGroupBy,
  dimensionsFor,
  labelForValue,
  labelForDimension,
  valuesPresent,
  KIND_ORDER,
  TAXONOMY
} from '../src/shared/taxonomy.ts'

test('parseTag splits on the first colon only', () => {
  assert.deepEqual(parseTag('genre:fantasy'), { dim: 'genre', value: 'fantasy' })
  assert.deepEqual(parseTag('lofi'), { dim: null, value: 'lofi' })
  // a stray second colon stays in the value, not a new dimension
  assert.deepEqual(parseTag('note:a:b'), { dim: 'note', value: 'a:b' })
  assert.deepEqual(parseTag('Genre:Fantasy').dim, 'genre')
})

test('makeTag normalizes dimension + value to slugs', () => {
  assert.equal(makeTag('Genre', 'Sci Fi'), 'genre:sci-fi')
  assert.equal(makeTag('location', 'Tavern'), 'location:tavern')
})

test('normalizeTag lowercases namespaced tags, preserves legacy case', () => {
  assert.equal(normalizeTag('Genre:Fantasy'), 'genre:fantasy')
  assert.equal(normalizeTag('  mood : Tense '), 'mood:tense')
  assert.equal(normalizeTag('LoFi'), 'LoFi') // free tag keeps its case
  assert.equal(normalizeTag('   '), '')
})

test('defaultGroupBy returns each kind first dimension', () => {
  assert.equal(defaultGroupBy('track'), 'genre')
  assert.equal(defaultGroupBy('ambience'), 'location')
  assert.equal(defaultGroupBy('sfx'), 'category')
})

test('every kind has at least one dimension and KIND_ORDER covers them', () => {
  for (const k of KIND_ORDER) assert.ok(dimensionsFor(k).length >= 1)
  assert.deepEqual(KIND_ORDER.slice().sort(), Object.keys(TAXONOMY).sort())
})

test('labelForValue / labelForDimension fall back to Title Case', () => {
  assert.equal(labelForValue('genre', 'fantasy'), 'Fantasy')
  assert.equal(labelForValue('genre', 'war-drums'), 'War Drums') // user-added
  assert.equal(labelForDimension('location'), 'Location')
  assert.equal(labelForDimension('custom-dim'), 'Custom Dim')
})

test('valuesPresent unions curated + user-added values, curated first', () => {
  const songs = [
    { kind: 'track' as const, tags: ['genre:fantasy', 'genre:noir', 'mood:tense'] },
    { kind: 'ambience' as const, tags: ['location:tavern'] } // wrong kind → ignored
  ]
  const vals = valuesPresent(songs, 'track', 'genre').map((x) => x.value)
  assert.ok(vals.includes('fantasy'))
  assert.ok(vals.includes('noir')) // user-added value surfaces
  // curated 'fantasy' sorts before the non-curated 'noir'
  assert.ok(vals.indexOf('fantasy') < vals.indexOf('noir'))
  // ambience-kind tag did not leak into the track dimension
  assert.equal(valuesPresent(songs, 'track', 'genre').some((x) => x.value === 'tavern'), false)
})
