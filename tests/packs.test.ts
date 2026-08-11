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

test('scene pack round-trips namespaced tags + item kind', () => {
  const a = newStore()
  const s1 = a.addSong(track({ videoId: 'v1', kind: 'ambience' }))
  a.retag(s1.id, { tags: ['genre:fantasy', 'mood:tense'] })
  const scene = a.saveScene({
    name: 'X',
    songIds: [s1.id],
    musicVolume: 1,
    currentIndex: 0,
    ambience: []
  })
  const pack = buildScenePack(a.snapshot(), scene.id)!
  assert.equal(pack.songs[0].kind, 'ambience')

  const b = newStore()
  importPack(b, validatePack(JSON.parse(JSON.stringify(pack))))
  const v1 = b.snapshot().songs.find((x) => x.videoId === 'v1')!
  assert.deepEqual(v1.tags, ['genre:fantasy', 'mood:tense'])
  assert.equal(v1.kind, 'ambience')
})

test('a pack song with no kind defaults to track on import', () => {
  const b = newStore()
  const pack = validatePack({
    kind: 'playlist',
    version: 1,
    name: 'P',
    songIds: ['v9'],
    songs: [{ videoId: 'v9', url: 'https://y/v9' }] // no kind field
  })
  assert.equal(pack.songs[0].kind, 'track')
  importPack(b, pack)
  assert.equal(b.snapshot().songs.find((s) => s.videoId === 'v9')!.kind, 'track')
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

test('validatePack bounds hostile input (DoS caps)', () => {
  // Too many songs → rejected fast (before building anything large).
  assert.throws(
    () => validatePack({ kind: 'playlist', name: 'X', songIds: [], songs: Array(5001).fill({ videoId: 'v', url: 'https://y' }) }),
    /too many songs/
  )

  // Within the song cap, the per-entry lists/strings are truncated, not rejected.
  const huge = 'x'.repeat(5000)
  const pack = validatePack({
    kind: 'scene',
    name: 'X',
    songIds: Array.from({ length: 20000 }, (_, i) => `id${i}`),
    musicVolume: 1,
    currentIndex: 0,
    ambience: [
      { songId: 'v1', volume: 1, pool: Array.from({ length: 10000 }, (_, i) => `p${i}`) },
      ...Array.from({ length: 200 }, () => ({ songId: 'v1', volume: 1 })) // 201 layers
    ],
    songs: [{ videoId: huge, url: huge, title: huge, artistName: huge, tags: Array(1000).fill('t') }]
  }) as Extract<ReturnType<typeof validatePack>, { kind: 'scene' }>

  assert.equal(pack.songIds.length, 10000) // MAX_PACK_SONGIDS
  assert.ok(pack.ambience.length <= 64) // MAX_PACK_AMBIENCE
  assert.equal(pack.ambience[0].pool!.length, 256) // MAX_PACK_POOL
  assert.equal(pack.songs[0].videoId.length, 2048) // MAX_PACK_STR
  assert.equal(pack.songs[0].title.length, 2048)
  assert.equal(pack.songs[0].tags.length, 32) // MAX_PACK_TAGS
})

test('a hostile pack imports quickly instead of hanging the main thread', () => {
  // Pre-cap, ~50k songs blocked import for >10s; the song cap keeps a hostile pack cheap.
  const b = newStore()
  assert.throws(() => validatePack({
    kind: 'playlist', name: 'flood', songIds: [],
    songs: Array.from({ length: 80000 }, (_, i) => ({ videoId: `v${i}`, url: `https://e/${i}` }))
  }), /too many songs/)
  // A pack at the cap still imports in well under a second.
  const pack = validatePack({
    kind: 'playlist', name: 'big', songIds: [],
    songs: Array.from({ length: 5000 }, (_, i) => ({ videoId: `v${i}`, url: `https://e/${i}` }))
  })
  importPack(b, pack)
  assert.equal(b.snapshot().songs.length, 5000)
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

// ---- Scene-document fields in packs (grimoire Phase 2) ----

test('scene-document fields round-trip through a pack; lastPlayedAt never travels', () => {
  const a = newStore()
  const s1 = a.addSong(track({ videoId: 'v1' }))
  const sfx = a.addSong(track({ videoId: 'vx', title: 'Door', kind: 'sfx' }))
  const scene = a.saveScene({
    name: 'Doc',
    songIds: [s1.id],
    musicVolume: 1,
    currentIndex: 0,
    ambience: [],
    note: 'The throne remembers.',
    pads: [{ songId: sfx.id, hotkey: '1', gain: 0.7, duckUnderMusic: true }],
    endOfList: 'loop-last',
    crossfadeMs: 4000,
    lastPlayedAt: 999
  })

  const pack = buildScenePack(a.snapshot(), scene.id)!
  assert.equal(pack.note, 'The throne remembers.')
  assert.equal(pack.endOfList, 'loop-last')
  assert.equal(pack.crossfadeMs, 4000)
  assert.deepEqual(pack.pads, [{ songId: 'vx', hotkey: '1', gain: 0.7, duckUnderMusic: true }])
  assert.ok(!('lastPlayedAt' in pack), 'local metadata never exported')

  const b = newStore()
  importPack(b, validatePack(JSON.parse(JSON.stringify(pack))))
  const imported = b.snapshot().scenes[0]
  assert.equal(imported.note, 'The throne remembers.')
  assert.equal(imported.endOfList, 'loop-last')
  assert.equal(imported.crossfadeMs, 4000)
  assert.equal(imported.pads?.length, 1)
  assert.equal(imported.pads?.[0].hotkey, '1')
  // pad songId re-keyed to the importer's internal id
  const bDoor = b.snapshot().songs.find((s) => s.videoId === 'vx')!
  assert.equal(imported.pads?.[0].songId, bDoor.id)
  assert.ok(!('lastPlayedAt' in imported), 'local metadata never imported')
})

test('hostile scene-document fields are capped, clamped, or dropped', () => {
  const base = {
    kind: 'scene',
    version: 1,
    name: 'Hostile',
    songIds: ['v1'],
    musicVolume: 0.5,
    currentIndex: 0,
    ambience: [],
    songs: [{ videoId: 'v1', url: 'https://x/1' }]
  }
  const big = validatePack({
    ...base,
    note: 'n'.repeat(100_000),
    pads: Array.from({ length: 1000 }, (_, i) => ({ songId: `v1`, hotkey: `${i}` })),
    endOfList: '__proto__',
    crossfadeMs: 9_999_999,
    lastPlayedAt: 123
  })
  assert.equal(big.kind, 'scene')
  if (big.kind !== 'scene') return
  assert.equal(big.note!.length, 4096, 'note truncated at the cap')
  assert.equal(big.pads!.length, 64, 'pads capped')
  assert.ok(!('endOfList' in big), 'unknown endOfList value dropped')
  assert.equal(big.crossfadeMs, 20000, 'crossfade clamped')
  assert.ok(!('lastPlayedAt' in big), 'local metadata dropped from untrusted input')

  const junkPads = validatePack({
    ...base,
    pads: [{ songId: 42 }, { songId: 'v1', gain: 7, hotkey: 9 }, 'garbage', null]
  })
  if (junkPads.kind !== 'scene') return
  assert.equal(junkPads.pads!.length, 1, 'non-object / non-string-songId pads dropped')
  assert.equal(junkPads.pads![0].gain, 1, 'gain clamped to [0,1]')
  assert.equal(junkPads.pads![0].hotkey, undefined, 'non-string hotkey dropped')
})

test('legacy packs without document fields validate and import unchanged', () => {
  const legacy = validatePack({
    kind: 'scene',
    version: 1,
    name: 'Old',
    songIds: ['v1'],
    musicVolume: 1,
    currentIndex: 0,
    ambience: [],
    songs: [{ videoId: 'v1', url: 'https://x/1' }]
  })
  if (legacy.kind !== 'scene') return
  assert.ok(!('note' in legacy))
  assert.ok(!('pads' in legacy))
  const b = newStore()
  importPack(b, legacy)
  assert.ok(!('note' in b.snapshot().scenes[0]))
})
