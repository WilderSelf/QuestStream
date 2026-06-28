import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mixer } from '../src/main/bot/Mixer.ts'
import { FFMPEG } from '../src/main/bot/binaries.ts'
import type { Song } from '../src/shared/types.ts'

// Soak / leak harness (plan A2). Kenku FM soft-crashes after 4–6h of continuous use
// (owlbear-rodeo/kenku-fm#158); a GM session runs that long. Our process lifecycle looks
// sound (SIGKILL cleanup, watchdogs, MAX_EMPTY_LOOPS, backpressure) — these tests *prove*
// the Mixer's input bookkeeping returns to baseline under churn so a leak would be caught.

/** Write a minimal valid silent WAV (48kHz/stereo/s16le) so ffmpeg has something to decode. */
function writeSilentWav(path: string, ms: number): void {
  const sampleRate = 48000
  const channels = 2
  const bytesPerSample = 2
  const frames = Math.floor((sampleRate * ms) / 1000)
  const dataLen = frames * channels * bytesPerSample
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // PCM fmt chunk size
  buf.writeUInt16LE(1, 20) // audio format = PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28) // byte rate
  buf.writeUInt16LE(channels * bytesPerSample, 32) // block align
  buf.writeUInt16LE(8 * bytesPerSample, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataLen, 40)
  // sample bytes stay zero (silence)
  writeFileSync(path, buf)
}

function ffmpegAvailable(): boolean {
  try {
    return spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

function localSong(path: string): Song {
  return {
    id: 'soak',
    albumId: '',
    artistId: '',
    title: 'soak',
    url: path,
    videoId: 'local:soak',
    duration: 0,
    tags: [],
    addedAt: 0,
    sourceType: 'local'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const HAS_FFMPEG = ffmpegAvailable()
const tmp = mkdtempSync(join(tmpdir(), 'qs-soak-'))
const wav = join(tmp, 'silence.wav')
writeSilentWav(wav, 120)
after(() => rmSync(tmp, { recursive: true, force: true }))

test('produceFrame counts frames and reports no underruns in a tight loop', () => {
  const mixer = new Mixer()
  for (let i = 0; i < 50; i++) mixer.produceFrame()
  const stats = mixer.getStats()
  assert.equal(stats.framesProduced, 50)
  assert.equal(stats.underruns, 0) // back-to-back pulls are never "late"
})

test('inputs map drains to zero across add/remove churn (no leak)', { skip: !HAS_FFMPEG }, () => {
  const mixer = new Mixer()
  const song = localSong(wav)
  const rssBefore = process.memoryUsage().rss
  for (let i = 0; i < 40; i++) {
    // A representative session frame: one music track, one looping ambience bed, one SFX.
    mixer.addInput('music', song, { loop: false })
    mixer.addInput('amb:1', song, { loop: true, gain: 0.4 })
    mixer.addInput(`sfx:${i}`, song, { loop: false })
    mixer.produceFrame()
    mixer.removeInput('amb:1', 0)
    mixer.removeInput('music', 0)
    mixer.removeInput(`sfx:${i}`, 0)
    mixer.produceFrame()
    assert.equal(mixer.size, 0, `cycle ${i}: expected inputs to drain to 0`)
  }
  mixer.destroy()
  assert.equal(mixer.size, 0)
  // Child ffmpeg processes are separate; our own RSS should stay roughly flat. A generous
  // ceiling catches a catastrophic buffer/handle leak without being flaky on GC timing.
  const rssGrowthMb = (process.memoryUsage().rss - rssBefore) / (1024 * 1024)
  assert.ok(rssGrowthMb < 200, `RSS grew ${rssGrowthMb.toFixed(0)}MB over the churn — possible leak`)
})

test('a one-shot reaps itself after its source ends naturally', { skip: !HAS_FFMPEG }, async () => {
  const mixer = new Mixer()
  mixer.addInput('sfx', localSong(wav), { loop: false })
  const deadline = Date.now() + 5000
  while (mixer.size > 0 && Date.now() < deadline) {
    mixer.produceFrame()
    await sleep(20)
  }
  assert.equal(mixer.size, 0, 'one-shot should reap itself once its source ends')
  mixer.destroy()
})
