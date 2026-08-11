// Draft → preview-request mapper (src/shared/scene-preview.ts). The builder's
// Preview button hands the engine exactly what the draft describes: the start
// track as the primary layer, playing ambience layers by mode, missing songs
// filtered rather than crashing the audition.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draftToPreviewRequest } from '../src/shared/scene-preview.ts'
import { newDraft } from '../src/shared/scene-edit.ts'
import type { SceneDraft } from '../src/shared/scene-edit.ts'
import type { Song } from '../src/shared/types.ts'

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
  ['a', 'b', 'c', 'rain', 'owl'].map((id) => [id, song(id)])
)

const draft = (over: Partial<SceneDraft> = {}): SceneDraft => ({
  ...newDraft(),
  songIds: ['a', 'b', 'c'],
  currentIndex: 1,
  musicVolume: 0.8,
  ...over
})

test('the start track maps to the primary layer with the music volume', () => {
  const req = draftToPreviewRequest(draft(), SONGS)
  assert.equal(req.layers.length, 1)
  assert.deepEqual(req.layers[0], { song: SONGS.b, volume: 0.8, loop: false })
})

test('a playing loop layer follows the primary with loop on and its own volume', () => {
  const req = draftToPreviewRequest(
    draft({
      ambience: [
        { songId: 'rain', volume: 0.5, playing: true, mode: 'loop', minIntervalSec: 20, maxIntervalSec: 60 }
      ]
    }),
    SONGS
  )
  assert.equal(req.layers.length, 2)
  assert.deepEqual(req.layers[1], { song: SONGS.rain, volume: 0.5, loop: true })
})

test('a random layer passes its single-song pool and interval through', () => {
  const req = draftToPreviewRequest(
    draft({
      ambience: [
        { songId: 'owl', volume: 0.4, playing: true, mode: 'random', minIntervalSec: 5, maxIntervalSec: 30 }
      ]
    }),
    SONGS
  )
  assert.deepEqual(req.layers[1], {
    song: SONGS.owl,
    volume: 0.4,
    loop: false,
    random: { pool: [SONGS.owl], minSec: 5, maxSec: 30 }
  })
})

test('paused layers stay out of the audition', () => {
  const req = draftToPreviewRequest(
    draft({
      ambience: [
        { songId: 'rain', volume: 0.5, playing: false, mode: 'loop', minIntervalSec: 20, maxIntervalSec: 60 }
      ]
    }),
    SONGS
  )
  assert.equal(req.layers.length, 1)
})

test('missing songs are filtered — a deleted start track leaves ambience-only audition', () => {
  const req = draftToPreviewRequest(
    draft({
      songIds: ['gone'],
      currentIndex: 0,
      ambience: [
        { songId: 'rain', volume: 0.5, playing: true, mode: 'loop', minIntervalSec: 20, maxIntervalSec: 60 },
        { songId: 'lost', volume: 0.5, playing: true, mode: 'loop', minIntervalSec: 20, maxIntervalSec: 60 }
      ]
    }),
    SONGS
  )
  assert.deepEqual(
    req.layers.map((l) => l.song.id),
    ['rain']
  )
})

test('an empty draft maps to an empty request (caller skips preview:start)', () => {
  assert.deepEqual(draftToPreviewRequest(newDraft(), SONGS), { layers: [] })
})
