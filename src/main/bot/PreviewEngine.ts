import { FRAME_BYTES, MixerInput } from './Mixer'
import { nextPumpDelay, FRAME_MS } from './preview-clock'
import { pickNextDelay, pickFromPool } from './random'
import { clamp01 } from '../../shared/num'
import type { PreviewRequest, PreviewStatus, Song } from '../../shared/types'

const INT16_PER_FRAME = FRAME_BYTES / 2
const STATUS_EVERY_FRAMES = 25 // ~500ms
const PCM_FRAMES_PER_EMIT = 2 // matches the live monitor's batching

/**
 * The subset of MixerInput the preview engine needs. Tests inject synthetic inputs
 * through the factory (the house seam — no mocking libraries); production uses the
 * real MixerInput, so a preview runs the exact yt-dlp → ffmpeg → loudnorm pipeline
 * the table hears — preview loudness honestly matches live loudness.
 */
export interface PreviewInputLike {
  readonly done: boolean
  paused: boolean
  readFrame(out: Int32Array): void
  setGain(target: number, rampMs: number): void
  kill(): void
}

export interface PreviewInputOpts {
  gain?: number
  loop?: boolean
  seekSec?: number
}

export type PreviewInputFactory = (id: string, song: Song, opts: PreviewInputOpts) => PreviewInputLike

interface RandomLayerState {
  pool: Song[]
  minSec: number
  maxSec: number
  gain: number
  nextAtMs: number
  shots: number // sequence for unique one-shot input ids
}

interface PreviewEngineOpts {
  onPcm: (pcm: Buffer) => void
  onStatus: (status: PreviewStatus) => void
  createInput?: PreviewInputFactory
  rand?: () => number
  /** false = no internal timer; the owner drives tick(nowMs) directly (tests). */
  autoPump?: boolean
}

const PRIMARY_ID = 'primary'

/**
 * The GM-only audition mixer (grimoire Phase 3). A second, fully isolated summing
 * loop: same frame math as the live Mixer, but pumped by its own drift-corrected
 * timer (preview-clock) and delivered to the renderer as PCM events — it has no
 * path to the Discord voice connection whatsoever (pinned by
 * tests/preview-isolation.test.ts). Layer 0 is the primary: it takes startSec and
 * its natural end stops the whole preview. Other layers loop or fire randomized
 * one-shots from a pool, mirroring live ambience scheduling.
 */
export class PreviewEngine {
  private inputs = new Map<string, PreviewInputLike>()
  private acc = new Int32Array(INT16_PER_FRAME)
  private randomLayers: RandomLayerState[] = []
  private running = false
  private hasPrimary = false
  private framesSent = 0
  private startedAtMs = 0
  private startSec = 0
  private durationSec = 0
  private masterVolume = 1
  private timer: NodeJS.Timeout | null = null
  private pendingFrames: Buffer[] = []
  private readonly onPcm: (pcm: Buffer) => void
  private readonly onStatus: (status: PreviewStatus) => void
  private readonly createInput: PreviewInputFactory
  private readonly rand: () => number
  private readonly autoPump: boolean

  constructor(opts: PreviewEngineOpts) {
    this.onPcm = opts.onPcm
    this.onStatus = opts.onStatus
    this.createInput = opts.createInput ?? ((id, song, o) => new MixerInput(id, song, o))
    this.rand = opts.rand ?? Math.random
    this.autoPump = opts.autoPump ?? true
  }

  get playing(): boolean {
    return this.running
  }

  /** True while the internal timer is armed — pinned by the no-leak test. */
  get pumping(): boolean {
    return this.timer !== null
  }

  /** Begin (or replace) the preview mix. `nowMs` anchors the frame timeline. */
  start(request: PreviewRequest, nowMs: number): void {
    this.teardown() // replace-on-start: prior inputs killed, no orphans
    const layers = request.layers.filter((l) => l.random || l.song)
    if (layers.length === 0) return
    this.running = true
    this.framesSent = 0
    this.startedAtMs = nowMs
    this.startSec = request.startSec ?? 0
    this.durationSec = layers[0].song?.duration ?? 0
    layers.forEach((layer, i) => {
      if (layer.random) {
        this.randomLayers.push({
          pool: layer.random.pool,
          minSec: layer.random.minSec,
          maxSec: layer.random.maxSec,
          gain: clamp01(layer.volume),
          nextAtMs: nowMs + pickNextDelay(layer.random.minSec, layer.random.maxSec, this.rand),
          shots: 0
        })
        return
      }
      const id = i === 0 ? PRIMARY_ID : `layer:${i}`
      if (i === 0) this.hasPrimary = true
      this.inputs.set(
        id,
        this.createInput(id, layer.song, {
          gain: clamp01(layer.volume),
          ...(layer.loop ? { loop: true } : {}),
          ...(i === 0 && this.startSec > 0 ? { seekSec: this.startSec } : {})
        })
      )
    })
    this.emitStatus()
    this.armTimer()
  }

  /** Master preview volume (applied at the sum, on top of per-layer gains). */
  setVolume(volume: number): void {
    this.masterVolume = clamp01(volume)
  }

  /** Stop the preview: kill every input, disarm the timer, emit a final status. */
  stop(): void {
    if (!this.running) return
    this.teardown()
    this.emitStatus()
  }

  /**
   * Produce exactly one 20ms frame (bounded burst — a stalled pump catches up one
   * frame per invocation) and run the random one-shot scheduler. Public so tests
   * drive a deterministic clock; production calls it from the internal timer.
   */
  tick(nowMs: number): void {
    if (!this.running) return

    for (const rl of this.randomLayers) {
      if (nowMs < rl.nextAtMs) continue
      const song = pickFromPool(rl.pool, this.rand)
      rl.nextAtMs = nowMs + pickNextDelay(rl.minSec, rl.maxSec, this.rand)
      if (!song) continue
      const id = `shot:${this.randomLayers.indexOf(rl)}:${rl.shots++}`
      this.inputs.set(id, this.createInput(id, song, { gain: rl.gain }))
    }

    this.acc.fill(0)
    for (const [id, input] of this.inputs) {
      if (input.done) {
        this.inputs.delete(id)
        continue
      }
      input.readFrame(this.acc)
      if (input.done) this.inputs.delete(id)
    }

    const out = Buffer.allocUnsafe(FRAME_BYTES)
    const vol = this.masterVolume
    for (let i = 0; i < INT16_PER_FRAME; i++) {
      let s = this.acc[i] * vol
      if (s > 32767) s = 32767
      else if (s < -32768) s = -32768
      out.writeInt16LE(s | 0, i * 2)
    }
    this.framesSent++
    this.pendingFrames.push(out)
    if (this.pendingFrames.length >= PCM_FRAMES_PER_EMIT) {
      this.onPcm(Buffer.concat(this.pendingFrames))
      this.pendingFrames = []
    }

    // The primary's natural end (non-loop) ends the audition — ambience alone is
    // not a preview. Its input reaped itself above once done.
    if (this.hasPrimary && !this.inputs.has(PRIMARY_ID)) {
      this.teardown()
      this.emitStatus()
      return
    }

    if (this.framesSent % STATUS_EVERY_FRAMES === 0) this.emitStatus()
  }

  private emitStatus(): void {
    this.onStatus({
      playing: this.running,
      positionSec: this.startSec + (this.framesSent * FRAME_MS) / 1000,
      durationSec: this.durationSec
    })
  }

  private armTimer(): void {
    if (!this.autoPump || !this.running) return
    const delay = nextPumpDelay(this.startedAtMs, this.framesSent, Date.now())
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick(Date.now())
      this.armTimer()
    }, delay)
  }

  /** Kill inputs, clear scheduling state, disarm the timer. No status emitted. */
  private teardown(): void {
    for (const input of this.inputs.values()) input.kill()
    this.inputs.clear()
    this.randomLayers = []
    this.pendingFrames = []
    this.running = false
    this.hasPrimary = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
