// PreviewEngine (src/main/bot/PreviewEngine.ts): the isolated GM-only audition mixer.
// Inputs are injected via a factory (house convention — no mocking libraries), the
// clock is driven by calling tick(nowMs) directly, and PCM/status land in arrays.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PreviewEngine,
  type PreviewInputLike,
  type PreviewInputOpts
} from '../src/main/bot/PreviewEngine.ts'
import { FRAME_BYTES } from '../src/main/bot/Mixer.ts'
import { FRAME_MS } from '../src/main/bot/preview-clock.ts'
import type { PreviewRequest, PreviewStatus, Song } from '../src/shared/types.ts'

const INT16_PER_FRAME = FRAME_BYTES / 2

const song = (id: string, duration = 120): Song => ({
  id,
  videoId: `vid-${id}`,
  title: id,
  url: `file:///${id}`,
  sourceType: 'local',
  kind: 'track',
  duration,
  addedAt: 0,
  tags: []
})

/** A synthetic input that adds a constant sample value each frame, for `frames` frames. */
class FakeInput implements PreviewInputLike {
  done = false
  paused = false
  killed = false
  framesRead = 0
  constructor(
    readonly id: string,
    readonly value: number,
    private framesLeft = Infinity
  ) {}
  readFrame(out: Int32Array): void {
    if (this.done) return
    this.framesRead++
    for (let i = 0; i < out.length; i++) out[i] += this.value
    if (--this.framesLeft <= 0) this.done = true
  }
  setGain(): void {}
  kill(): void {
    this.done = true
    this.killed = true
  }
}

interface Harness {
  engine: PreviewEngine
  created: Array<{ id: string; song: Song; opts: PreviewInputOpts; input: FakeInput }>
  pcm: Buffer[]
  statuses: PreviewStatus[]
}

const harness = (framesFor: (id: string) => number = () => Infinity, value = 1000): Harness => {
  const created: Harness['created'] = []
  const pcm: Buffer[] = []
  const statuses: PreviewStatus[] = []
  const engine = new PreviewEngine({
    autoPump: false,
    rand: () => 0,
    createInput: (id, s, opts) => {
      const input = new FakeInput(id, value, framesFor(id))
      created.push({ id, song: s, opts, input })
      return input
    },
    onPcm: (b) => pcm.push(b),
    onStatus: (s) => statuses.push(s)
  })
  return { engine, created, pcm, statuses }
}

const req = (over: Partial<PreviewRequest> = {}): PreviewRequest => ({
  layers: [{ song: song('music'), volume: 1, loop: false }],
  ...over
})

const pump = (h: Harness, startMs: number, frames: number): void => {
  for (let f = 0; f < frames; f++) h.engine.tick(startMs + f * FRAME_MS)
}

test('two layers sum per-sample at FRAME_BYTES granularity, batched two frames per emit', () => {
  const h = harness()
  h.engine.start(
    req({
      layers: [
        { song: song('music'), volume: 1, loop: false },
        { song: song('rain'), volume: 1, loop: true }
      ]
    }),
    0
  )
  pump(h, 0, 2)
  assert.equal(h.pcm.length, 1) // 2 frames → 1 batched emit
  assert.equal(h.pcm[0].length, FRAME_BYTES * 2)
  for (let i = 0; i < INT16_PER_FRAME * 2; i++) {
    assert.equal(h.pcm[0].readInt16LE(i * 2), 2000) // 1000 + 1000, both frames
  }
})

test('layer volume is passed to the input factory; master volume scales the sum', () => {
  const h = harness()
  h.engine.start(req({ layers: [{ song: song('music'), volume: 0.4, loop: false }] }), 0)
  assert.equal(h.created[0].opts.gain, 0.4)
  h.engine.setVolume(0.5)
  pump(h, 0, 2)
  for (let i = 0; i < INT16_PER_FRAME; i++) {
    assert.equal(h.pcm[0].readInt16LE(i * 2), 500) // 1000 * 0.5 master
  }
})

test('start while running replaces the mix — every prior input is killed, none orphaned', () => {
  const h = harness()
  h.engine.start(
    req({
      layers: [
        { song: song('a'), volume: 1, loop: false },
        { song: song('b'), volume: 1, loop: true }
      ]
    }),
    0
  )
  pump(h, 0, 4)
  const first = [...h.created]
  h.engine.start(req({ layers: [{ song: song('c'), volume: 1, loop: false }] }), 100)
  assert.ok(first.every((c) => c.input.killed), 'all first-mix inputs killed on replace')
  assert.equal(h.engine.playing, true)
  pump(h, 100, 2)
  const fresh = h.created.filter((c) => !first.includes(c))
  assert.equal(fresh.length, 1)
  assert.ok(fresh[0].input.framesRead > 0, 'replacement mix is the one being pumped')
})

test('primary startSec reaches the factory as seekSec and offsets reported position', () => {
  const h = harness()
  h.engine.start(req({ startSec: 42 }), 0)
  assert.equal(h.created[0].opts.seekSec, 42)
  assert.equal(h.statuses[0].positionSec, 42)
})

test('a non-loop primary ending stops the engine and emits a final not-playing status', () => {
  const h = harness((id) => (id === 'primary' ? 3 : Infinity))
  h.engine.start(
    req({
      layers: [
        { song: song('music', 77), volume: 1, loop: false },
        { song: song('rain'), volume: 1, loop: true }
      ]
    }),
    0
  )
  pump(h, 0, 3)
  assert.equal(h.engine.playing, false)
  const last = h.statuses[h.statuses.length - 1]
  assert.equal(last.playing, false)
  assert.equal(last.durationSec, 77)
  assert.ok(h.created.every((c) => c.input.done), 'ambience killed when the primary ends')
  // A stray tick after stop is inert:
  const emitted = h.pcm.length
  h.engine.tick(200)
  assert.equal(h.pcm.length, emitted)
})

test('stop kills every input, emits a final status, and leaves no timer armed', () => {
  const h = harness()
  h.engine.start(
    req({
      layers: [
        { song: song('music'), volume: 1, loop: true },
        { song: song('rain'), volume: 1, loop: true }
      ]
    }),
    0
  )
  pump(h, 0, 2)
  h.engine.stop()
  assert.equal(h.engine.playing, false)
  assert.equal(h.engine.pumping, false)
  assert.ok(h.created.every((c) => c.input.killed))
  assert.equal(h.statuses[h.statuses.length - 1].playing, false)
  h.engine.stop() // idempotent — no double final status
  assert.equal(h.statuses.filter((s) => !s.playing).length, 1)
})

test('with real timers, stop disarms the pump (no leaked handle)', () => {
  const created: FakeInput[] = []
  const engine = new PreviewEngine({
    rand: () => 0,
    createInput: (id) => {
      const i = new FakeInput(id, 0)
      created.push(i)
      return i
    },
    onPcm: () => {},
    onStatus: () => {}
  })
  engine.start(req(), Date.now())
  assert.equal(engine.pumping, true)
  engine.stop()
  assert.equal(engine.pumping, false)
})

test('a random layer draws one-shots from its pool on the injected schedule', () => {
  const h = harness()
  const pool = [song('owl'), song('wolf')]
  h.engine.start(
    req({
      layers: [
        { song: song('music'), volume: 1, loop: true },
        { song: pool[0], volume: 0.6, loop: false, random: { pool, minSec: 1, maxSec: 1 } }
      ]
    }),
    0
  )
  // rand=0 → pickNextDelay(1,1) = 1000ms; no one-shot before that.
  pump(h, 0, 2)
  assert.equal(h.created.length, 1, 'random layer spawns nothing at start')
  h.engine.tick(1000)
  const shots = h.created.filter((c) => c.song.id === 'owl')
  assert.equal(shots.length, 1, 'one-shot fires when its delay elapses')
  assert.equal(shots[0].opts.gain, 0.6)
  assert.equal(shots[0].opts.loop, undefined, 'one-shots never loop')
  // Next shot is rescheduled 1s out from the fire time:
  h.engine.tick(1020)
  assert.equal(h.created.filter((c) => c.song.id === 'owl').length, 1)
  h.engine.tick(2000)
  assert.equal(h.created.filter((c) => c.song.id === 'owl').length, 2)
})

test('status is emitted on start and roughly every half second while playing', () => {
  const h = harness()
  h.engine.start(req(), 0)
  assert.equal(h.statuses.length, 1)
  assert.deepEqual(h.statuses[0], { playing: true, positionSec: 0, durationSec: 120 })
  pump(h, 0, 51) // 25-frame cadence → two more statuses
  assert.equal(h.statuses.length, 3)
  const last = h.statuses[h.statuses.length - 1]
  assert.equal(last.playing, true)
  assert.ok(last.positionSec > 0.9 && last.positionSec <= 1.1, `position ~1s, got ${last.positionSec}`)
})
