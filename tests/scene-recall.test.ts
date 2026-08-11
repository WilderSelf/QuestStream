// Pure recall-plan builder (src/shared/scene-recall.ts). The first tests pin exact
// parity with store.recallScene's inline logic (missing songs filtered, legacy pool
// expansion, 20/60 interval defaults, items[currentIndex] ?? items[0] start clamp);
// the rest pin the new partial-recall options for the scene page's Play controls.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecallPlan } from '../src/shared/scene-recall.ts'
import type { Scene, Song } from '../src/shared/types.ts'

const song = (id: string): Song => ({
  id,
  videoId: `vid-${id}`,
  title: id,
  url: `file:///${id}`,
  sourceType: 'local',
  kind: 'track',
  duration: 60,
  addedAt: 0,
  tags: []
})

const SONGS: Record<string, Song> = Object.fromEntries(
  ['a', 'b', 'c', 'rain', 'owl', 'wolf'].map((id) => [id, song(id)])
)

const scene = (over: Partial<Scene> = {}): Scene => ({
  id: 'sc1',
  name: 'Ambush',
  songIds: ['a', 'b', 'c'],
  currentIndex: 1,
  musicVolume: 0.8,
  ambience: [],
  createdAt: 0,
  updatedAt: 0,
  ...over
})

test('legacy parity: filtered queue, start at currentIndex, volume through, no crossfade sentinel', () => {
  const plan = buildRecallPlan(scene({ songIds: ['a', 'gone', 'b', 'c'] }), SONGS)
  assert.deepEqual(
    plan.music?.songs.map((s) => s.id),
    ['a', 'b', 'c']
  )
  // Legacy indexes the FILTERED list directly — currentIndex 1 lands on 'b'.
  assert.equal(plan.music?.startIndex, 1)
  assert.equal(plan.music?.musicVolume, 0.8)
  assert.equal(plan.crossfadeMs, null)
})

test('legacy parity: an out-of-range start falls back to the first track', () => {
  const plan = buildRecallPlan(scene({ currentIndex: 7 }), SONGS)
  assert.equal(plan.music?.startIndex, 0)
})

test('legacy parity: multi-song pools expand to one layer per sound with 20/60 defaults', () => {
  const plan = buildRecallPlan(
    scene({
      ambience: [
        { songId: 'rain', volume: 0.5, playing: true, pool: ['owl', 'wolf', 'gone'], mode: 'random' }
      ]
    }),
    SONGS
  )
  assert.deepEqual(
    plan.ambience?.map((l) => l.song.id),
    ['owl', 'wolf']
  )
  for (const l of plan.ambience ?? []) {
    assert.equal(l.volume, 0.5)
    assert.equal(l.playing, true)
    assert.equal(l.mode, 'random')
    assert.equal(l.minSec, 20)
    assert.equal(l.maxSec, 60)
  }
})

test('legacy parity: a poolless layer plays its songId, defaulting mode to loop', () => {
  const plan = buildRecallPlan(
    scene({
      ambience: [{ songId: 'rain', volume: 0.4, playing: false, minIntervalSec: 5, maxIntervalSec: 9 }]
    }),
    SONGS
  )
  assert.deepEqual(plan.ambience, [
    { song: SONGS.rain, volume: 0.4, playing: false, mode: 'loop', minSec: 5, maxSec: 9 }
  ])
})

test('includeMusic:false leaves the live queue untouched — ambience still builds', () => {
  const plan = buildRecallPlan(
    scene({ ambience: [{ songId: 'rain', volume: 0.5, playing: true }] }),
    SONGS,
    { includeMusic: false }
  )
  assert.equal(plan.music, null)
  assert.equal(plan.ambience?.length, 1)
})

test('includeAmbience:false leaves the live layers untouched — music still builds', () => {
  const plan = buildRecallPlan(
    scene({ ambience: [{ songId: 'rain', volume: 0.5, playing: true }] }),
    SONGS,
    { includeAmbience: false }
  )
  assert.equal(plan.ambience, null)
  assert.equal(plan.music?.songs.length, 3)
})

test('startIndex override wins over the scene start (same clamp rule)', () => {
  assert.equal(buildRecallPlan(scene(), SONGS, { startIndex: 2 }).music?.startIndex, 2)
  assert.equal(buildRecallPlan(scene(), SONGS, { startIndex: 9 }).music?.startIndex, 0)
})

test('keepVolumes: the queue is replaced but the live music volume is left alone', () => {
  const plan = buildRecallPlan(scene(), SONGS, { keepVolumes: true })
  assert.equal(plan.music?.songs.length, 3)
  assert.equal(plan.music?.musicVolume, null) // null = caller must not touch the fader
  // Without the flag the scene's saved volume applies (pinned above too):
  assert.equal(buildRecallPlan(scene(), SONGS).music?.musicVolume, 0.8)
})

test('a scene crossfade passes through; an all-missing queue yields an empty music list', () => {
  assert.equal(buildRecallPlan(scene({ crossfadeMs: 4000 }), SONGS).crossfadeMs, 4000)
  const plan = buildRecallPlan(scene({ songIds: ['gone', 'lost'] }), SONGS)
  assert.deepEqual(plan.music?.songs, [])
  assert.equal(plan.music?.startIndex, 0)
})
