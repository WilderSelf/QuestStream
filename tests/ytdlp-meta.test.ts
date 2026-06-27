import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveMeta } from '../src/main/bot/ytdlp.ts'

test('deriveMeta keeps the source title verbatim (no cruft-stripping)', () => {
  const m = deriveMeta({ title: 'Song Name (Official Video) [HD]', uploader: 'Cool Channel' })
  assert.equal(m.title, 'Song Name (Official Video) [HD]')
  assert.equal(m.artistName, 'Cool Channel')
})

test('deriveMeta does NOT split "Artist - Title" out of the title', () => {
  const m = deriveMeta({ title: 'Daft Punk - Around the World (Official Video)' })
  assert.equal(m.title, 'Daft Punk - Around the World (Official Video)')
  assert.equal(m.artistName, 'Unknown Artist') // no structured artist/uploader → last resort
})

test('deriveMeta prefers structured YT Music fields when present', () => {
  const m = deriveMeta({
    track: 'Real Track',
    artist: 'Real Artist',
    album: 'Real Album',
    title: 'noisy title (Official Video)'
  })
  assert.equal(m.title, 'Real Track')
  assert.equal(m.artistName, 'Real Artist')
  assert.equal(m.albumTitle, 'Real Album')
})

test('deriveMeta keeps the uploader/channel as-is for the artist', () => {
  // "- Topic" is kept verbatim — we no longer rewrite the source's reported channel name.
  const m = deriveMeta({ title: 'Some Ambient Loop', uploader: 'Cool Channel - Topic' })
  assert.equal(m.artistName, 'Cool Channel - Topic')
  assert.equal(m.title, 'Some Ambient Loop')
})

test('deriveMeta uses Unknown Artist / Singles as last resorts', () => {
  const m = deriveMeta({ title: 'Lonely Track' })
  assert.equal(m.artistName, 'Unknown Artist')
  assert.equal(m.albumTitle, 'Singles')
  assert.equal(m.title, 'Lonely Track')
})

test('deriveMeta honors the album hint when no album is present', () => {
  const m = deriveMeta({ title: 'Track', artist: 'A' }, 'Playlist Name')
  assert.equal(m.albumTitle, 'Playlist Name')
})

test('deriveMeta handles unicode titles without corruption', () => {
  const m = deriveMeta({ title: '東方 - 永夜抄 (Lyrics)', artist: 'ZUN' })
  assert.equal(m.title, '東方 - 永夜抄 (Lyrics)')
  assert.equal(m.artistName, 'ZUN')
})
