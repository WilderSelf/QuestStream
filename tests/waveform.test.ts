// Progressive waveform peaks (src/shared/waveform.ts): the triage canvas folds
// preview:pcm chunks into per-bucket peaks. Bucket math must be exact, partial
// buckets carry across chunk boundaries, and growth is bounded.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newPeaks, appendPeaks } from '../src/shared/waveform.ts'

const pcm = (...vals: number[]): Int16Array => Int16Array.from(vals)

test('full buckets emit the absolute peak, normalized to 0..1', () => {
  const s = appendPeaks(newPeaks(), pcm(100, -32768, 50, 7, 8, 16384, -2, 0), 4)
  assert.equal(s.peaks.length, 2)
  assert.equal(s.peaks[0], 1) // |-32768| / 32768
  assert.equal(s.peaks[1], 0.5) // 16384 / 32768
  assert.equal(s.carryCount, 0)
})

test('a partial bucket carries its running max across chunk boundaries', () => {
  let s = appendPeaks(newPeaks(), pcm(1, 2, 3, 4, 30000, -5), 4)
  assert.equal(s.peaks.length, 1)
  assert.equal(s.carryCount, 2)
  s = appendPeaks(s, pcm(6, 7), 4)
  assert.equal(s.peaks.length, 2)
  assert.equal(s.peaks[1], 30000 / 32768) // the carried max wins the completed bucket
  assert.equal(s.carryCount, 0)
})

test('growth is bounded: buckets beyond the cap are dropped', () => {
  let s = newPeaks()
  for (let i = 0; i < 10; i++) s = appendPeaks(s, pcm(1, 1, 1, 1), 4, 5)
  assert.equal(s.peaks.length, 5)
})

test('appending nothing changes nothing', () => {
  const s0 = newPeaks()
  const s1 = appendPeaks(s0, pcm(), 4)
  assert.deepEqual(s1, s0)
})
