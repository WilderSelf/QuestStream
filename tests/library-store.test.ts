import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LibraryStore } from '../src/main/library/store.ts'

const dirs: string[] = []
function newStore(): LibraryStore {
  const dir = mkdtempSync(join(tmpdir(), 'qs-lib-'))
  dirs.push(dir)
  return new LibraryStore(join(dir, 'library.json'))
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const track = (over: Partial<Parameters<LibraryStore['addSong']>[0]> = {}) => ({
  videoId: 'vid1',
  url: 'https://youtube.com/watch?v=vid1',
  title: 'Song One',
  artistName: 'Artist A',
  albumTitle: 'Album A',
  duration: 200,
  ...over
})

test('addSong creates artist/album/song and links them', () => {
  const s = newStore()
  const song = s.addSong(track())
  const db = s.snapshot()
  assert.equal(db.songs.length, 1)
  assert.equal(db.artists.length, 1)
  assert.equal(db.albums.length, 1)
  assert.equal(song.artistId, db.artists[0].id)
  assert.equal(song.albumId, db.albums[0].id)
  assert.deepEqual(song.tags, [])
})

test('addSong dedupes by videoId', () => {
  const s = newStore()
  const a = s.addSong(track())
  const b = s.addSong(track({ title: 'Different title, same video' }))
  assert.equal(a.id, b.id)
  assert.equal(s.snapshot().songs.length, 1)
})

test('hasSong tracks existence so re-imports are not re-counted/re-tagged', () => {
  const s = newStore()
  assert.equal(s.hasSong('vid1'), false)
  s.addSong(track())
  assert.equal(s.hasSong('vid1'), true) // a second import would be a de-duped no-op
})

test('addSong falls back to Unknown Artist / Untitled', () => {
  const s = newStore()
  const song = s.addSong(track({ artistName: '   ', title: '   ' }))
  const db = s.snapshot()
  assert.equal(song.title, 'Untitled')
  assert.equal(db.artists[0].name, 'Unknown Artist')
})

test('artists/albums are reused case-insensitively', () => {
  const s = newStore()
  s.addSong(track({ videoId: 'v1', artistName: 'Artist A', albumTitle: 'Album A' }))
  s.addSong(track({ videoId: 'v2', artistName: 'artist a', albumTitle: 'album a' }))
  const db = s.snapshot()
  assert.equal(db.artists.length, 1)
  assert.equal(db.albums.length, 1)
})

test('retag normalizes tags: trim, drop empties, de-dupe, cap at 32', () => {
  const s = newStore()
  const song = s.addSong(track())
  const many = Array.from({ length: 40 }, (_, i) => `tag${i}`)
  s.retag(song.id, { tags: ['  Combat  ', 'combat', '', '   ', 'Tavern', ...many] })
  const tags = s.snapshot().songs[0].tags
  assert.equal(tags.length, 32)
  assert.equal(tags[0], 'Combat')
  // case-insensitive de-dupe kept only the first "Combat"
  assert.equal(tags.filter((t) => t.toLowerCase() === 'combat').length, 1)
})

test('retag normalizes namespaced tags but preserves legacy free-tag case', () => {
  const s = newStore()
  const song = s.addSong(track())
  s.retag(song.id, { tags: ['Genre:Fantasy', 'mood : Tense', 'LoFi'] })
  const tags = s.snapshot().songs[0].tags
  assert.deepEqual(tags, ['genre:fantasy', 'mood:tense', 'LoFi'])
})

test('addSong stamps kind + tags; legacy songs default kind to track', () => {
  const s = newStore()
  const amb = s.addSong(track({ videoId: 'v1', kind: 'ambience', tags: ['Location:Tavern'] }))
  const def = s.addSong(track({ videoId: 'v2' }))
  const db = s.snapshot()
  const a = db.songs.find((x) => x.id === amb.id)!
  assert.equal(a.kind, 'ambience')
  assert.deepEqual(a.tags, ['location:tavern'])
  assert.equal(db.songs.find((x) => x.id === def.id)!.kind, 'track')
})

test('addSong dedupe leaves an existing song kind/tags untouched', () => {
  const s = newStore()
  const first = s.addSong(track({ videoId: 'v1', kind: 'ambience', tags: ['location:tavern'] }))
  const again = s.addSong(track({ videoId: 'v1', kind: 'sfx', tags: ['category:magic'] }))
  assert.equal(first.id, again.id)
  const db = s.snapshot()
  assert.equal(db.songs[0].kind, 'ambience')
  assert.deepEqual(db.songs[0].tags, ['location:tavern'])
})

test('retag can re-classify an item kind', () => {
  const s = newStore()
  const song = s.addSong(track())
  s.retag(song.id, { kind: 'sfx' })
  assert.equal(s.snapshot().songs[0].kind, 'sfx')
})

test('retag changing artist moves the album and GCs the orphan', () => {
  const s = newStore()
  const song = s.addSong(track({ artistName: 'Old Artist' }))
  s.retag(song.id, { artistName: 'New Artist' })
  const db = s.snapshot()
  assert.ok(db.artists.some((a) => a.name === 'New Artist'))
  assert.ok(!db.artists.some((a) => a.name === 'Old Artist'), 'orphaned old artist GCed')
  assert.equal(db.artists.length, 1)
})

test('deleteSong removes the song, its refs, and GCs empties', () => {
  const s = newStore()
  const song = s.addSong(track())
  const pl = s.savePlaylist('P', [song.id])
  s.saveScene({
    name: 'S',
    songIds: [song.id],
    musicVolume: 1,
    currentIndex: 0,
    ambience: [{ songId: song.id, volume: 0.5, playing: true }]
  })
  s.deleteSong(song.id)
  const db = s.snapshot()
  assert.equal(db.songs.length, 0)
  assert.equal(db.artists.length, 0)
  assert.equal(db.albums.length, 0)
  assert.deepEqual(db.playlists.find((p) => p.id === pl.id)?.songIds, [])
  assert.deepEqual(db.scenes[0].songIds, [])
  assert.deepEqual(db.scenes[0].ambience, [])
})

test('savePlaylist updates in place when given an id', () => {
  const s = newStore()
  const a = s.addSong(track({ videoId: 'v1' }))
  const b = s.addSong(track({ videoId: 'v2' }))
  const pl = s.savePlaylist('Mix', [a.id])
  const updated = s.savePlaylist('Mix v2', [a.id, b.id], pl.id)
  assert.equal(updated.id, pl.id)
  assert.equal(s.snapshot().playlists.length, 1)
  assert.equal(s.snapshot().playlists[0].name, 'Mix v2')
  assert.equal(s.snapshot().playlists[0].songIds.length, 2)
})

test('addSong defaults sourceType to youtube; local files carry their type', () => {
  const s = newStore()
  const yt = s.addSong(track({ videoId: 'v1' }))
  const local = s.addSong(
    track({ videoId: 'local:abc', url: '/data/media/abc.mp3', sourceType: 'local' })
  )
  const db = s.snapshot()
  assert.equal(db.songs.find((x) => x.id === yt.id)?.sourceType, 'youtube')
  assert.equal(db.songs.find((x) => x.id === local.id)?.sourceType, 'local')
})

test('migration backfills sourceType + kind + soundboard for old libraries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qs-lib-'))
  dirs.push(dir)
  const path = join(dir, 'library.json')
  // Hand-write a pre-feature library: a song with no sourceType/kind, no soundboard key.
  const legacy = {
    artists: [{ id: 'a1', name: 'A' }],
    albums: [{ id: 'al1', artistId: 'a1', title: 'Al' }],
    songs: [
      { id: 's1', albumId: 'al1', artistId: 'a1', title: 'T', url: 'https://y/x', videoId: 'x', duration: 1, tags: [], addedAt: 1 }
    ],
    playlists: [],
    scenes: []
  }
  writeFileSync(path, JSON.stringify(legacy), 'utf8')
  const s = new LibraryStore(path)
  const db = s.snapshot()
  assert.equal(db.songs[0].sourceType, 'youtube')
  assert.equal(db.songs[0].kind, 'track')
  assert.deepEqual(db.soundboard, [])
})

test('migration reclassifies soundboard-referenced songs as sfx', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qs-lib-'))
  dirs.push(dir)
  const path = join(dir, 'library.json')
  const legacy = {
    artists: [{ id: 'a1', name: 'A' }],
    albums: [{ id: 'al1', artistId: 'a1', title: 'Al' }],
    songs: [
      { id: 's1', albumId: 'al1', artistId: 'a1', title: 'Music', url: 'https://y/x', videoId: 'x', duration: 1, tags: [], addedAt: 1 },
      { id: 's2', albumId: 'al1', artistId: 'a1', title: 'Clang', url: 'https://y/y', videoId: 'y', duration: 1, tags: [], addedAt: 1 }
    ],
    playlists: [],
    scenes: [],
    soundboard: [{ id: 'sb1', songId: 's2' }]
  }
  writeFileSync(path, JSON.stringify(legacy), 'utf8')
  const db = new LibraryStore(path).snapshot()
  assert.equal(db.songs.find((s) => s.id === 's1')!.kind, 'track')
  assert.equal(db.songs.find((s) => s.id === 's2')!.kind, 'sfx')
})

test('soundboard CRUD: add, set unique hotkey, remove', () => {
  const s = newStore()
  const a = s.addSong(track({ videoId: 'v1' }))
  const b = s.addSong(track({ videoId: 'v2' }))
  const i1 = s.addSoundboardItem(a.id)
  const i2 = s.addSoundboardItem(b.id)
  s.updateSoundboardItem(i1.id, { hotkey: 'q', duckUnderMusic: true })
  s.updateSoundboardItem(i2.id, { hotkey: 'q' }) // steals 'q' from i1
  let db = s.snapshot()
  assert.equal(db.soundboard.find((x) => x.id === i1.id)?.hotkey, undefined)
  assert.equal(db.soundboard.find((x) => x.id === i2.id)?.hotkey, 'q')
  assert.equal(db.soundboard.find((x) => x.id === i1.id)?.duckUnderMusic, true)
  s.removeSoundboardItem(i2.id)
  db = s.snapshot()
  assert.equal(db.soundboard.length, 1)
})

test('deleteSong removes soundboard + random-pool references', () => {
  const s = newStore()
  const a = s.addSong(track({ videoId: 'v1' })) // layer's primary track
  const b = s.addSong(track({ videoId: 'v2' })) // only in the pool + soundboard
  s.addSoundboardItem(b.id)
  s.saveScene({
    name: 'S',
    songIds: [a.id],
    musicVolume: 1,
    currentIndex: 0,
    ambience: [{ songId: a.id, volume: 0.5, playing: true, mode: 'random', pool: [a.id, b.id] }]
  })
  s.deleteSong(b.id)
  const db = s.snapshot()
  assert.equal(db.soundboard.length, 0) // b's soundboard item removed
  // the layer (primary a) survives, but b is pruned from its pool
  assert.deepEqual(db.scenes[0].ambience[0]?.pool, [a.id])
})

test('setEffect sets and clears a song effect', () => {
  const s = newStore()
  const a = s.addSong(track())
  s.setEffect(a.id, 'cavern')
  assert.equal(s.snapshot().songs[0].effect, 'cavern')
  s.setEffect(a.id, null)
  assert.equal(s.snapshot().songs[0].effect, undefined)
})

test('flush persists and a fresh store reloads it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qs-lib-'))
  dirs.push(dir)
  const path = join(dir, 'library.json')
  const s1 = new LibraryStore(path)
  const song = s1.addSong(track())
  s1.flush()
  const s2 = new LibraryStore(path)
  assert.equal(s2.snapshot().songs.length, 1)
  assert.equal(s2.snapshot().songs[0].id, song.id)
})
