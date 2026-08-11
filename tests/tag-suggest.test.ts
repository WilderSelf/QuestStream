// Type-ahead tag suggestions (src/shared/tag-suggest.ts). Scoring order:
// value-prefix > dimension-prefix > substring > subsequence; ties keep the
// taxonomy's curated order; custom (free) tags rank like values.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestTags } from '../src/shared/tag-suggest.ts'
import { dimensionsFor } from '../src/shared/taxonomy.ts'

const DIMS = dimensionsFor('track') // genre, activity, mood, location

test("'tav' finds Location · Tavern by value prefix", () => {
  const out = suggestTags('tav', DIMS, [])
  assert.equal(out[0].tag, 'location:tavern')
  assert.equal(out[0].label, 'Tavern')
  assert.equal(out[0].dimLabel, 'Location')
})

test('a dimension-name query surfaces that dimension’s values in curated order', () => {
  const out = suggestTags('mood', DIMS, [])
  assert.deepEqual(
    out.slice(0, 3).map((s) => s.tag),
    ['mood:tense', 'mood:peace', 'mood:mysterious']
  )
})

test('custom tags are included and rank like values', () => {
  const out = suggestTags('lo', DIMS, ['LoFi'])
  assert.equal(out[0].tag, 'LoFi') // value-prefix beats location's dimension-prefix
  assert.equal(out[0].dimLabel, undefined)
  assert.ok(out.some((s) => s.tag === 'location:tavern'), 'dimension-prefix values follow')
})

test('scoring order: value-prefix, then substring, then subsequence', () => {
  const out = suggestTags('e', DIMS, [], 50)
  const tags = out.map((s) => s.tag)
  // Value prefixes first, in dims order (activity before mood for 'track'):
  assert.deepEqual(tags.slice(0, 3), ['activity:exploration', 'mood:epic', 'mood:eerie'])
  // A substring match ranks after every prefix match:
  assert.ok(tags.indexOf('mood:tense') > tags.indexOf('mood:eerie'))
})

test('subsequence catches typo-ish compressed queries', () => {
  const out = suggestTags('cbt', DIMS, [])
  assert.ok(out.some((s) => s.tag === 'activity:combat'))
})

test('matching is case-insensitive and respects the limit', () => {
  const out = suggestTags('E', DIMS, [], 2)
  assert.equal(out.length, 2)
  assert.equal(out[0].tag, 'activity:exploration')
})

test('an empty or whitespace query suggests nothing', () => {
  assert.deepEqual(suggestTags('', DIMS, ['x']), [])
  assert.deepEqual(suggestTags('   ', DIMS, ['x']), [])
})
