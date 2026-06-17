import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, deriveMeta } from '../src/main/bot/ytdlp.ts'

test('cleanTitle strips common YouTube cruft', () => {
  assert.equal(cleanTitle('Song Name (Official Video)'), 'Song Name')
  assert.equal(cleanTitle('Song Name [HD]'), 'Song Name')
  assert.equal(cleanTitle('Song Name (Lyrics)'), 'Song Name')
  assert.equal(cleanTitle('Song Name (Official Music Video)'), 'Song Name')
  assert.equal(cleanTitle('Artist - Topic'), 'Artist')
  assert.equal(cleanTitle('Spaced    Out    Title'), 'Spaced Out Title')
})

test('cleanTitle leaves a clean title untouched', () => {
  assert.equal(cleanTitle('Just A Normal Title'), 'Just A Normal Title')
})

test('deriveMeta prefers structured YT Music fields', () => {
  const m = deriveMeta({ track: 'Real Track', artist: 'Real Artist', album: 'Real Album', title: 'noisy title (Official Video)' })
  assert.equal(m.title, 'Real Track')
  assert.equal(m.artistName, 'Real Artist')
  assert.equal(m.albumTitle, 'Real Album')
})

test('deriveMeta parses "Artist - Title" from the video title', () => {
  const m = deriveMeta({ title: 'Daft Punk - Around the World (Official Video)' })
  assert.equal(m.artistName, 'Daft Punk')
  assert.equal(m.title, 'Around the World')
})

test('deriveMeta falls back to the uploader (minus "- Topic")', () => {
  const m = deriveMeta({ title: 'Some Ambient Loop', uploader: 'Cool Channel - Topic' })
  assert.equal(m.artistName, 'Cool Channel')
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
  const m = deriveMeta({ title: '東方 - 永夜抄 (Lyrics)' })
  assert.equal(m.artistName, '東方')
  assert.equal(m.title, '永夜抄')
})
