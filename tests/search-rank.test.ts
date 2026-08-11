// Scoped seeker ranker (src/shared/search-rank.ts). Groups: the open scene's
// tracks (boosted, deduped from the library group), scenes, library, actions
// (with aliases) — same scorer as the tag type-ahead, deterministic, capped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankSeeker } from '../src/shared/search-rank.ts'
import type { Scene, Song } from '../src/shared/types.ts'

const song = (id: string, title: string): Song => ({
  id,
  videoId: `v-${id}`,
  title,
  url: `file:///${id}`,
  sourceType: 'local',
  kind: 'track',
  duration: 60,
  addedAt: 0,
  tags: []
})

const scene = (id: string, name: string): Scene => ({
  id,
  name,
  songIds: [],
  currentIndex: 0,
  musicVolume: 1,
  ambience: [],
  createdAt: 0,
  updatedAt: 0
})

const CTX = {
  songs: [
    song('s1', 'Steel & Thunder'),
    song('s2', 'Quiet Rain'),
    song('s3', 'Thundering Hooves')
  ],
  scenes: [scene('sc1', 'Ambush on the Road'), scene('sc2', 'Quiet Tavern')],
  sceneScopeSongIds: ['s1'],
  actions: [
    { id: 'duck', label: 'Duck the mix', aliases: ['quiet', 'lower'] },
    { id: 'import', label: 'Import audio', aliases: ['add'] }
  ]
}

test('scene-scope tracks rank in their own group and never duplicate into the library group', () => {
  const hits = rankSeeker('thunder', CTX)
  const sceneHits = hits.filter((h) => h.group === 'scene')
  const libHits = hits.filter((h) => h.group === 'library')
  assert.deepEqual(sceneHits.map((h) => h.id), ['s1'])
  assert.deepEqual(libHits.map((h) => h.id), ['s3'])
})

test('scenes match by name; groups keep their fixed order', () => {
  const hits = rankSeeker('quiet', CTX)
  const groups = hits.map((h) => h.group)
  assert.ok(hits.some((h) => h.group === 'scenes' && h.id === 'sc2'))
  // scene-scope group (none here) < scenes < library < actions:
  assert.deepEqual([...groups].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)), groups)
  const order = ['scene', 'scenes', 'library', 'actions']
  for (let i = 1; i < groups.length; i++) {
    assert.ok(order.indexOf(groups[i]) >= order.indexOf(groups[i - 1]), `order violated at ${i}`)
  }
})

test('action aliases match ("quiet" also surfaces Duck the mix)', () => {
  const hits = rankSeeker('quiet', CTX)
  assert.ok(hits.some((h) => h.group === 'actions' && h.id === 'duck'))
})

test('within a group, a title prefix beats a substring; ties keep input order', () => {
  const hits = rankSeeker('t', { ...CTX, sceneScopeSongIds: [] })
  const lib = hits.filter((h) => h.group === 'library').map((h) => h.id)
  // 'Thundering Hooves' (prefix) before 'Steel & Thunder' (substring):
  assert.ok(lib.indexOf('s3') < lib.indexOf('s1'))
})

test('per-group caps limit output', () => {
  const many = { ...CTX, songs: Array.from({ length: 20 }, (_, i) => song(`m${i}`, `Torch ${i}`)) }
  const hits = rankSeeker('torch', many, { library: 3 })
  assert.equal(hits.filter((h) => h.group === 'library').length, 3)
})

test('an empty query ranks nothing', () => {
  assert.deepEqual(rankSeeker('', CTX), [])
  assert.deepEqual(rankSeeker('   ', CTX), [])
})
