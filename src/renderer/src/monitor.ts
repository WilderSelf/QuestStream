/**
 * Plays the bot's mixed PCM on the host's own speakers (local monitoring / jukebox).
 *
 * Plain 1:1 ring buffer — samples are copied straight to the output with NO
 * drift-correction resampling, so playback can't warble. Incoming PCM is fixed
 * 48kHz s16le stereo (Discord's mandatory Opus rate), and the AudioContext is
 * created at 48kHz to MATCH it (see start()); Chromium then statically resamples
 * 48kHz → the hardware rate in its output thread, the same way the OS mixer does.
 * Because context rate == producer rate, the 1:1 copy is correct on every device
 * (not just 48kHz ones). The buffer just absorbs IPC jitter; under/overflow are
 * handled discretely and counted so a real clock drift would still be visible.
 */
const WORKLET_SRC = `
class PCMRing extends AudioWorkletProcessor {
  constructor() {
    super()
    this._cap = 48000 * 8 * 2                  // 8s capacity, interleaved stereo
    this._buf = new Float32Array(this._cap)
    this._r = 0                                 // read index (interleaved)
    this._w = 0                                 // write index (interleaved)
    this._count = 0                             // interleaved samples queued
    this._prime = Math.floor(0.25 * 48000) * 2  // start after ~250ms buffered
    this._primed = false
    this._underruns = 0
    this._overflows = 0
    this._proc = 0
    this.port.onmessage = (e) => {
      const d = e.data
      const cap = this._cap, buf = this._buf
      for (let i = 0; i < d.length; i++) {
        buf[this._w] = d[i]
        if (++this._w === cap) this._w = 0
        if (this._count < cap) this._count++
        else { if (++this._r === cap) this._r = 0; this._overflows++ } // overwrite oldest
      }
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0]
    const ch0 = out[0]
    const ch1 = out[1] || out[0]
    const frames = ch0.length
    if (++this._proc >= 375) {
      this._proc = 0
      this.port.postMessage({ stats: { fillMs: Math.round((this._count / 2 / 48000) * 1000), underruns: this._underruns, overflows: this._overflows } })
    }
    if (!this._primed) {
      if (this._count < this._prime) { ch0.fill(0); ch1.fill(0); return true }
      this._primed = true
    }
    const cap = this._cap, buf = this._buf
    for (let i = 0; i < frames; i++) {
      if (this._count < 2) {                    // underrun → silence, re-prime
        for (; i < frames; i++) { ch0[i] = 0; ch1[i] = 0 }
        this._underruns++
        this._primed = false
        return true
      }
      ch0[i] = buf[this._r]; if (++this._r === cap) this._r = 0
      ch1[i] = buf[this._r]; if (++this._r === cap) this._r = 0
      this._count -= 2
    }
    return true
  }
}
registerProcessor('pcm-ring', PCMRing)
`

/** AudioContext.setSinkId is shipping in Electron's Chromium but not yet in the TS DOM lib. */
type SinkCapableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

export class LocalMonitor {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private gain: GainNode | null = null
  private localVolume = 0.8 // independent volume for the LOCAL monitor path (NOT the Discord send level)
  private sinkId = '' // chosen output device ('' = system default)
  private starting = false

  async start(): Promise<void> {
    if (this.ctx || this.starting) return
    this.starting = true
    try {
      // Force the context to the producer rate (48 kHz). The worklet copies PCM 1:1
      // with NO resampling, so it is only correct when context rate == producer rate.
      // Requesting 48000 makes that true on EVERY device: Chromium inserts a static
      // sample-rate converter to the hardware rate in its output thread (the same path
      // the OS mixer uses) — a fixed ratio, NOT the forbidden drift-feedback loop.
      // See HANDOFF §5.4 / gotcha #3 for why this is safe and distinct from warble.
      const ctx = new AudioContext({ sampleRate: 48000 })
      // 48000 is honoured in practice (it's the common hardware rate and Chromium's
      // preferred). If a device ever refuses it, the 1:1 copy would mis-pitch — warn
      // loudly rather than fail silently. (Fallback if it ever fires: resample
      // 48k → ctx.sampleRate in the worklet via libsamplerate-js — see HANDOFF.)
      if (ctx.sampleRate !== 48000) {
        console.warn(
          `[monitor] AudioContext came back at ${ctx.sampleRate}Hz, not 48000 — local output ` +
            `will be wrong-pitched. Needs the worklet-resampler fallback (HANDOFF §5.4).`
        )
      } else {
        console.log('[monitor] AudioContext @ 48000Hz (platform resamples to the device)')
      }
      const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)

      const node = new AudioWorkletNode(ctx, 'pcm-ring', { outputChannelCount: [2] })
      // Master volume for local output lives here: the worklet stays a 1:1 copy, and a
      // GainNode scales the whole mix before the speakers. (The Discord path applies the
      // same master volume via the AudioResource; the monitor taps the mix before that,
      // so without this node the master slider had no effect on local playback.)
      const gain = new GainNode(ctx, { gain: this.localVolume })
      node.connect(gain)
      gain.connect(ctx.destination)
      this.gain = gain
      // Warn only if the buffer actually starves/overflows (real clock drift).
      let lastBad = 0
      node.port.onmessage = (e) => {
        const s = e.data?.stats
        if (!s) return
        const bad = s.underruns + s.overflows
        if (bad > lastBad) {
          console.warn(`[monitor] glitch — buffer=${s.fillMs}ms underruns=${s.underruns} overflows=${s.overflows}`)
          lastBad = bad
        }
      }
      this.ctx = ctx
      this.node = node
      await ctx.resume()
      // Re-target the chosen output device on (re)start. The monitor stops/starts on every
      // Discord join/leave, so a device picked once must be re-applied each time.
      if (this.sinkId) await this.applySink(ctx)
    } catch (err) {
      console.error('[monitor] failed to start:', err)
    } finally {
      this.starting = false
    }
  }

  stop(): void {
    this.node?.disconnect()
    this.gain?.disconnect()
    void this.ctx?.close()
    this.ctx = null
    this.node = null
    this.gain = null
  }

  /** Volume for local playback (0..1), independent of the Discord send level. Ramped to avoid zipper noise. */
  setVolume(v: number): void {
    this.localVolume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(this.localVolume, this.ctx.currentTime, 0.015)
    }
  }

  /**
   * Choose which output device the local monitor plays to ('' = system default).
   * Applied immediately if running, and re-applied on the next start(). deviceId strings
   * can rotate across reboots/unplugs, so a stale id just falls back to default (the catch).
   */
  async setSinkId(deviceId: string): Promise<void> {
    this.sinkId = deviceId || ''
    if (this.ctx) await this.applySink(this.ctx)
  }

  private async applySink(ctx: AudioContext): Promise<void> {
    const c = ctx as SinkCapableContext
    if (typeof c.setSinkId !== 'function') return
    try {
      await c.setSinkId(this.sinkId)
    } catch (err) {
      console.warn('[monitor] setSinkId failed (device gone?) — falling back to default:', err)
    }
  }

  feed(bytes: Uint8Array): void {
    const ctx = this.ctx
    if (!ctx || !this.node) return
    // CRITICAL: only push while the context is actually running. A suspended
    // context (autoplay policy, before a gesture) doesn't consume frames, so
    // accumulating here builds a multi-second backlog → startup delay + long tail.
    if (ctx.state !== 'running') {
      void ctx.resume()
      return
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const n = bytes.byteLength >> 1 // int16 sample count
    const f = new Float32Array(n)
    for (let i = 0; i < n; i++) f[i] = view.getInt16(i * 2, true) / 32768
    this.node.port.postMessage(f, [f.buffer])
  }
}

export const localMonitor = new LocalMonitor()
