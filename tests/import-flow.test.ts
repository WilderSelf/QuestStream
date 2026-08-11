// Arriving-row reducer + untagged selectors (src/shared/import-flow.ts). The
// workbench table is a pure fold over library:importProgress events — rows keyed
// by source url, terminal states sticky against stragglers, errors persistent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  reduceImportRows,
  isUntagged,
  untaggedInbox,
  type ImportRow
} from '../src/shared/import-flow.ts'
import type { ImportProgress, Song } from '../src/shared/types.ts'

const ev = (over: Partial<ImportProgress>): ImportProgress => ({
  url: 'https://y.tube/w?v=1',
  status: 'resolving',
  ...over
})

test('resolve → importing → done updates one row through its lifecycle', () => {
  let rows: ImportRow[] = []
  rows = reduceImportRows(rows, ev({ status: 'resolving' }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'resolving')
  rows = reduceImportRows(rows, ev({ status: 'importing', total: 12, completed: 3 }))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].total, 12)
  assert.equal(rows[0].completed, 3)
  rows = reduceImportRows(rows, ev({ status: 'done', total: 12, completed: 12, addedSongIds: ['a'] }))
  assert.equal(rows[0].status, 'done')
  assert.deepEqual(rows[0].addedSongIds, ['a'])
})

test('distinct urls get distinct rows, newest first', () => {
  let rows: ImportRow[] = []
  rows = reduceImportRows(rows, ev({ url: 'u1' }))
  rows = reduceImportRows(rows, ev({ url: 'u2' }))
  assert.deepEqual(
    rows.map((r) => r.url),
    ['u2', 'u1']
  )
})

test('a duplicate event is terminal and carries the existing song id', () => {
  let rows: ImportRow[] = []
  rows = reduceImportRows(rows, ev({ status: 'resolving' }))
  rows = reduceImportRows(rows, ev({ status: 'duplicate', duplicateOfSongId: 's9' }))
  assert.equal(rows[0].status, 'duplicate')
  assert.equal(rows[0].duplicateOfSongId, 's9')
  // A straggling 'importing' can't resurrect it:
  rows = reduceImportRows(rows, ev({ status: 'importing', completed: 1 }))
  assert.equal(rows[0].status, 'duplicate')
})

test('error rows persist and stay errored against stragglers', () => {
  let rows: ImportRow[] = []
  rows = reduceImportRows(rows, ev({ status: 'resolving' }))
  rows = reduceImportRows(rows, ev({ status: 'error', message: 'nope' }))
  rows = reduceImportRows(rows, ev({ status: 'importing' }))
  assert.equal(rows[0].status, 'error')
  assert.equal(rows[0].message, 'nope')
})

test('a fresh resolving on a finished row starts a NEW attempt row', () => {
  let rows: ImportRow[] = []
  rows = reduceImportRows(rows, ev({ status: 'done', addedSongIds: ['a'] }))
  rows = reduceImportRows(rows, ev({ status: 'resolving' }))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].status, 'resolving') // newest first
  assert.equal(rows[1].status, 'done')
})

const song = (id: string, tags: string[] | undefined, addedAt: number): Song => ({
  id,
  videoId: `v-${id}`,
  title: id,
  url: `file:///${id}`,
  sourceType: 'local',
  kind: 'track',
  duration: 60,
  addedAt,
  tags: tags as string[]
})

test('isUntagged: empty or missing tags counts, any tag does not', () => {
  assert.equal(isUntagged(song('a', [], 0)), true)
  assert.equal(isUntagged(song('b', undefined, 0)), true)
  assert.equal(isUntagged(song('c', ['mood:tense'], 0)), false)
})

test('untaggedInbox lists untagged songs newest-added first', () => {
  const inbox = untaggedInbox([
    song('old', [], 100),
    song('tagged', ['mood:epic'], 300),
    song('new', [], 200)
  ])
  assert.deepEqual(
    inbox.map((s) => s.id),
    ['new', 'old']
  )
})
