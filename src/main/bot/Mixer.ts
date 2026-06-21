import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { ytDlp, cookieArgs, FFMPEG, YT_CLIENT_ARGS, SPAWN_ENV } from './binaries'
import { buildAfChain } from './effects'
import { clamp01 } from '../../shared/num'
import type { Song } from '../../shared/types'

// Re-export so existing importers (DiscordBot) keep `import { clamp01 } from './Mixer'`.
export { clamp01 }

// Discord voice PCM format: 48kHz, 16-bit, stereo, 20ms frames.
export const SAMPLE_RATE = 48000
export const CHANNELS = 2
const FRAME_MS = 20
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000 // 960 per channel
const INT16_PER_FRAME = SAMPLES_PER_FRAME * CHANNELS // 1920
export const FRAME_BYTES = INT16_PER_FRAME * 2 // 3840
export const BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * 2 // 192000

// Bound buffered PCM to a few seconds — ffmpeg decodes faster than realtime, so
// without backpressure a long track would buffer entirely into RAM.
const HIGH_WATER = BYTES_PER_SEC * 6
const LOW_WATER = BYTES_PER_SEC * 2

// If a freshly-spawned input produces no PCM within this window, treat it as a dead
// stream (network hang, removed/blocked video) and fail it instead of buffering forever.
const FIRST_BYTE_TIMEOUT_MS = 25_000

// If a looping input respawns this many times in a row producing zero PCM, its source
// has died mid-session — stop instead of churning yt-dlp/ffmpeg forever.
const MAX_EMPTY_LOOPS = 2

interface InputOpts {
  gain?: number
  fadeInMs?: number
  loop?: boolean
  seekSec?: number
  onEnd?: () => void
  onError?: (reason: string) => void
}

/**
 * One mixer input: yt-dlp downloads the audio, ffmpeg loudness-normalizes it to
 * raw PCM (real-time `loudnorm`, no perceptible delay), and we buffer the PCM so
 * the mixer can pull fixed 20ms frames on demand. Gain is interpolated per frame
 * for click-free fades/crossfades.
 */
export class MixerInput {
  private chunks: Buffer[] = []
  private queued = 0
  private closed = false
  private ended = false
  private gain: number
  private target: number
  private step = 1
  private ytdlp: ChildProcessWithoutNullStreams | null = null
  private ffmpeg: ChildProcessWithoutNullStreams | null = null
  private realBytes = 0
  private flowPaused = false
  private gotData = false
  private watchdog: NodeJS.Timeout | null = null
  private cycleBytes = 0 // PCM produced by the current (re)spawn; resets each spawn
  private emptyLoops = 0 // consecutive loop respawns that produced nothing
  removeWhenSilent = false
  paused = false
  onEnd?: () => void // reassignable so a prefetched input can be adopted as the current track
  onError?: (reason: string) => void // reassignable for the same reason

  constructor(
    readonly id: string,
    readonly song: Song,
    private readonly opts: InputOpts = {}
  ) {
    this.gain = clamp01(opts.gain ?? 1)
    this.target = this.gain
    this.onEnd = opts.onEnd
    this.onError = opts.onError
    this.spawn(opts.seekSec ?? 0)
    if (opts.fadeInMs && opts.fadeInMs > 0) this.setGain(opts.gain ?? 1, opts.fadeInMs)
  }

  private spawn(seekSec: number): void {
    this.closed = false
    this.flowPaused = false
    this.cycleBytes = 0
    this.realBytes = 0 // reset so a looping input's positionSec restarts each loop (no unbounded growth)

    // Local files: ffmpeg reads the path directly (no yt-dlp, no network). This is
    // safe — the static-ffmpeg HTTPS-segfault (HANDOFF §5.1) only affects network
    // input; a local pipe/file is fine. YouTube/url sources still go yt-dlp → pipe.
    //
    // SECURITY INVARIANT: handing the path straight to `-i` is only safe because every
    // caller routes through DiscordBot.playable() → isInMediaDir(), so for a local song
    // `url` is always an absolute, normalized path inside the media dir — it can never be
    // `-`-leading (mistaken for an ffmpeg option) or a `proto:`/`http:` input. The assert
    // below is defense-in-depth in case a future caller forgets that precondition.
    const isLocal = this.song.sourceType === 'local'
    if (isLocal && !isAbsolute(this.song.url)) {
      this.fail('refusing to play a non-absolute local path')
      return
    }
    let ytdlp: ChildProcessWithoutNullStreams | null = null
    if (!isLocal) {
      ytdlp = spawn(
        ytDlp(),
        [
          '-f', 'bestaudio/best',
          '-o', '-',
          '--quiet', '--no-warnings', '--no-playlist',
          ...cookieArgs(),
          ...YT_CLIENT_ARGS,
          '--', // stop option parsing: a URL can never be misread as a yt-dlp flag (e.g. --exec)
          this.song.url
        ],
        { windowsHide: true, env: SPAWN_ENV }
      )
    }
    const ffArgs = [
      '-i', isLocal ? this.song.url : 'pipe:0',
      ...(seekSec > 0 ? ['-ss', String(seekSec)] : []),
      '-af', buildAfChain(this.song.effect),
      '-ar', String(SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-f', 's16le',
      '-loglevel', 'error',
      'pipe:1'
    ]
    const ffmpeg = spawn(FFMPEG, ffArgs, { windowsHide: true, env: SPAWN_ENV })
    this.ytdlp = ytdlp
    this.ffmpeg = ffmpeg

    if (ytdlp) {
      ytdlp.stdout.on('error', () => {})
      ffmpeg.stdin.on('error', () => {})
      ytdlp.stdout.pipe(ffmpeg.stdin)
      ytdlp.on('error', (e) => console.error('[mixer:yt-dlp]', e.message))
    }
    ffmpeg.on('error', (e) => console.error('[mixer:ffmpeg]', e.message))
    ffmpeg.stderr.on('data', (d) => {
      const m = d.toString().trim()
      if (m) console.error('[mixer:ffmpeg]', m)
    })

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      if (!this.gotData) {
        this.gotData = true
        this.clearWatchdog() // audio is flowing → the resolve succeeded
      }
      this.cycleBytes += chunk.length
      this.chunks.push(chunk)
      this.queued += chunk.length
      if (!this.flowPaused && this.queued >= HIGH_WATER) {
        this.flowPaused = true
        ffmpeg.stdout.pause() // backpressure → ffmpeg blocks → yt-dlp throttles download
      }
    })
    ffmpeg.stdout.on('end', () => {
      this.closed = true
      // Ended having produced nothing → the stream was dead from the start.
      if (!this.gotData) this.fail('no audio produced — the video may be unavailable, private, or region-blocked')
    })

    // One-shot watchdog for a hung resolve. This is NOT a mixer clock (gotcha #5 is
    // about driving frame production) — it just bounds how long we wait for byte 0.
    if (!this.gotData) {
      this.clearWatchdog()
      this.watchdog = setTimeout(
        () => this.fail('timed out resolving audio (no data after 25s)'),
        FIRST_BYTE_TIMEOUT_MS
      )
    }
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
  }

  /** Abort this input after an unrecoverable error; the mixer drops it next frame. */
  private fail(reason: string): void {
    if (this.ended) return
    console.error(`[mixer:${this.id}] ${reason}`)
    this.kill() // stops processes + marks ended
    this.onError?.(reason)
  }

  /** Set a new target gain reached over `rampMs` (0 = immediate). */
  setGain(target: number, rampMs: number): void {
    this.target = clamp01(target)
    if (rampMs <= 0) {
      this.gain = this.target
      this.step = 1
    } else {
      const frames = Math.max(1, rampMs / FRAME_MS)
      this.step = Math.abs(this.target - this.gain) / frames
    }
  }

  private advanceGain(): number {
    if (this.gain < this.target) this.gain = Math.min(this.target, this.gain + this.step)
    else if (this.gain > this.target) this.gain = Math.max(this.target, this.gain - this.step)
    return this.gain
  }

  private take(n: number): Buffer {
    if (this.queued === 0) return Buffer.alloc(0)
    const out = Buffer.alloc(Math.min(n, this.queued))
    let off = 0
    while (off < out.length && this.chunks.length) {
      const c = this.chunks[0]
      const need = out.length - off
      if (c.length <= need) {
        c.copy(out, off)
        off += c.length
        this.chunks.shift()
      } else {
        c.copy(out, off, 0, need)
        this.chunks[0] = c.subarray(need)
        off += need
      }
    }
    this.queued -= out.length
    if (this.flowPaused && this.queued <= LOW_WATER) {
      this.flowPaused = false
      this.ffmpeg?.stdout.resume()
    }
    return out
  }

  /** True once this input has finished and fully drained (mixer should drop it). */
  get done(): boolean {
    return this.ended
  }

  get isSilent(): boolean {
    return this.gain === 0 && this.target === 0
  }

  get positionSec(): number {
    return (this.opts.seekSec ?? 0) + this.realBytes / BYTES_PER_SEC
  }

  /** Pull exactly FRAME_BYTES, applying gain, summing into `out`. No-op once dead. */
  readFrame(out: Int32Array): void {
    if (this.ended) return
    const data = this.take(FRAME_BYTES)
    this.realBytes += data.length

    if (data.length < FRAME_BYTES) {
      if (this.closed && this.queued === 0) {
        if (this.opts.loop) {
          // Track empty respawns: a source that died mid-session would otherwise
          // respawn forever. After MAX_EMPTY_LOOPS productive-failures in a row, stop.
          if (this.cycleBytes > 0) this.emptyLoops = 0
          else this.emptyLoops++
          if (this.emptyLoops >= MAX_EMPTY_LOOPS) this.fail('looping source stopped producing audio')
          else this.spawn(0) // seamless-ish restart for looping ambience
        } else {
          // natural end: emit once, then mark dead next cycle
          if (!this.ended) {
            this.ended = true
            this.onEnd?.()
          }
        }
      }
      // pad the rest of the frame with silence (zeros already in `out` accumulation)
    }

    const g = this.advanceGain()
    const samples = data.length >> 1
    for (let i = 0; i < samples; i++) {
      out[i] += data.readInt16LE(i * 2) * g
    }
    if (this.removeWhenSilent && this.isSilent) this.kill()
  }

  kill(): void {
    this.clearWatchdog()
    this.ended = true
    this.ffmpeg?.kill('SIGKILL')
    this.ytdlp?.kill('SIGKILL')
    this.ffmpeg = null
    this.ytdlp = null
    this.chunks = []
    this.queued = 0
  }
}

/**
 * Sums any number of MixerInputs into a single continuous PCM stream for Discord.
 * The stream never ends — it emits silence when idle — so the voice connection
 * stays warm and inputs can come and go (music crossfades, ambience loops) live.
 */
export class Mixer {
  /** Optional tap on every mixed frame (used for local monitoring). */
  onFrame: ((frame: Buffer) => void) | null = null
  private inputs = new Map<string, MixerInput>()
  private acc = new Int32Array(INT16_PER_FRAME)

  get size(): number {
    return this.inputs.size
  }

  /** Advance every input by one 20ms frame and return the mixed PCM (silence if idle). */
  produceFrame(): Buffer {
    this.acc.fill(0)
    for (const input of this.inputs.values()) {
      if (input.done) {
        this.inputs.delete(input.id) // reap finished/failed inputs (incl. paused prefetch)
        continue
      }
      if (input.paused) continue // true pause: don't advance, contribute silence
      input.readFrame(this.acc)
      if (input.done) this.inputs.delete(input.id)
    }
    const out = Buffer.allocUnsafe(FRAME_BYTES)
    for (let i = 0; i < INT16_PER_FRAME; i++) {
      let s = this.acc[i]
      if (s > 32767) s = 32767
      else if (s < -32768) s = -32768
      out.writeInt16LE(s, i * 2)
    }
    this.onFrame?.(out)
    return out
  }

  setPaused(id: string, paused: boolean): void {
    const input = this.inputs.get(id)
    if (input) input.paused = paused
  }

  addInput(id: string, song: Song, opts: InputOpts = {}): MixerInput {
    this.removeInput(id, 0)
    const input = new MixerInput(id, song, opts)
    this.inputs.set(id, input)
    return input
  }

  getInput(id: string): MixerInput | undefined {
    return this.inputs.get(id)
  }

  setGain(id: string, gain: number, rampMs = 0): void {
    this.inputs.get(id)?.setGain(gain, rampMs)
  }

  /** Fade out then drop an input (rampMs 0 = immediate). */
  removeInput(id: string, rampMs = 0): void {
    const input = this.inputs.get(id)
    if (!input) return
    if (rampMs <= 0) {
      input.kill()
      this.inputs.delete(id)
    } else {
      input.removeWhenSilent = true
      input.setGain(0, rampMs)
    }
  }

  destroy(): void {
    for (const input of this.inputs.values()) input.kill()
    this.inputs.clear()
  }
}
