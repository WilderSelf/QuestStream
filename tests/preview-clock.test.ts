// Drift-corrected preview pump pacing (src/main/bot/preview-clock.ts). Pure math —
// the pump must track the absolute timeline, never accumulate per-tick lateness, and
// recover from stalls one frame per tick without negative delays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextPumpDelay, FRAME_MS } from '../src/main/bot/preview-clock.ts'

test('on-time pump waits exactly one frame', () => {
  // 5 frames sent, now exactly at frame 5's ideal send time minus nothing:
  assert.equal(nextPumpDelay(1000, 5, 1000 + 5 * FRAME_MS - FRAME_MS), FRAME_MS)
})

test('a late tick shortens the next delay instead of accumulating drift', () => {
  // frame 3 is due at t=1060; at t=1055 the delay is 5ms, not a full 20.
  assert.equal(nextPumpDelay(1000, 3, 1055), 5)
})

test('a stalled pump returns 0 to catch up, never a negative delay', () => {
  assert.equal(nextPumpDelay(1000, 3, 1200), 0)
  assert.equal(nextPumpDelay(1000, 0, 5000), 0)
})

test('a bad clock jump cannot park the pump beyond one frame', () => {
  // now is somehow far before the start time (clock adjusted backwards):
  assert.equal(nextPumpDelay(10_000, 0, 1000), FRAME_MS)
})

test('the schedule is absolute: lateness on one tick does not shift later targets', () => {
  const start = 0
  // Send frame 10 late (at t=250 instead of 200)…
  assert.equal(nextPumpDelay(start, 10, 250), 0)
  // …frame 11's target is still t=220 (absolute), so from t=250 it is also overdue…
  assert.equal(nextPumpDelay(start, 11, 250), 0)
  // …and once caught up to frame 13 (target 260), the wait is the true remainder.
  assert.equal(nextPumpDelay(start, 13, 250), 10)
})
