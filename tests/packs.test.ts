import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryStore } from '../src/main/library/store.ts'
import { buildScenePack, buildPlaylistPack, validatePack, importPack } from '../src/main/library/packs.ts'

const dirs: string[] = []
function newStore(): LibraryStore {
  const dir = mkdtempSync(join(tmpdir(), 'qs-pack-'))
  dirs.push(dir)
  return new LibraryStore(join(dir, 'library.json'))
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const track = (over = {}) => ({
  videoId: 'v1',
  url: 'https://youtube.com/watch?v=v1',
  title: 'Song',
  artistName: 'Artist',
  albumTitle: 'Album',
  duration: 100,
  ...over
})

test('scene pack round-trips through export → import into a fresh library', () => {
  const a = newStore()
  const s1 = a.addSong(track({ videoId: 'v1' }))
  const s2 = a.addSong(track({ videoId: 'v2', artistName: 'Other' }))
  a.retag(s1.id, { tags: ['Combat'] })
  a.setEffect(s1.id, 'cavern')
  const scene = a.saveScene({
    name: 'Boss',
    songIds: [s1.id, s2.id],
    musicVolume: 0.8,
    currentIndex: 1,
    ambience: [{ songId: s2.id, volume: 0.4, playing: true, mode: 'random', pool: [s1.id, s2.id] }]
  })

  const pack = buildScenePack(a.snapshot(), scene.id)
  assert.ok(pack)
  assert.equal(pack!.songs.length, 2)
  // pack references songs by videoId, not internal id
  assert.deepEqual(pack!.songIds, ['v1', 'v2'])

  // Import into an empty library (simulating another user)
  const b = newStore()
  const created = importPack(b, validatePack(JSON.parse(JSON.stringify(pack))))
  const db = b.snapshot()
  assert.equal(created.kind, 'scene')
  assert.equal(db.songs.length, 2)
  assert.equal(db.scenes.length, 1)
  const imported = db.scenes[0]
  assert.equal(imported.songIds.length, 2)
  assert.equal(imported.currentIndex, 1)
  assert.equal(imported.ambience[0].pool!.length, 2)
  // tags + effect carried for newly-created songs
  const v1 = db.songs.find((x) => x.videoId === 'v1')!
  assert.deepEqual(v1.tags, ['Combat'])
  assert.equal(v1.effect, 'cavern')
})

test('importing does not clobber an existing song\'s tags', () => {
  const b = newStore()
  const existing = b.addSong(track({ videoId: 'v1' }))
  b.retag(existing.id, { tags: ['MyTag'] })
  const pack = validatePack({
    kind: 'playlist',
    version: 1,
    name: 'P',
    songIds: ['v1'],
    songs: [{ ...track({ videoId: 'v1' }), tags: ['ForeignTag'], sourceType: 'youtube' }]
  })
  importPack(b, pack)
  assert.deepEqual(b.snapshot().songs.find((s) => s.videoId === 'v1')!.tags, ['MyTag'])
})

test('validatePack rejects malformed input', () => {
  assert.throws(() => validatePack(null))
  assert.throws(() => validatePack({ kind: 'bogus' }))
  assert.throws(() => validatePack({ kind: 'scene' })) // no songs array
  assert.throws(() => validatePack({ kind: 'playlist', songs: [{ title: 'no videoId' }] }))
})

test('validatePack clamps volumes and defaults fields', () => {
  const pack = validatePack({
    kind: 'scene',
    name: '',
    songIds: ['v1'],
    musicVolume: 5, // out of range → clamped to 1
    currentIndex: -3, // invalid → 0
    ambience: [{ songId: 'v1', volume: -2 }],
    songs: [{ videoId: 'v1', url: 'https://y/v1' }]
  }) as Extract<ReturnType<typeof validatePack>, { kind: 'scene' }>
  assert.equal(pack.name, 'Imported')
  assert.equal(pack.musicVolume, 1)
  assert.equal(pack.currentIndex, 0)
  assert.equal(pack.ambience[0].volume, 0)
  assert.equal(pack.songs[0].sourceType, 'youtube')
})
