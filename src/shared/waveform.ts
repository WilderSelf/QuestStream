/**
 * Progressive waveform peaks (grimoire Phase 7): folds streaming s16le PCM into
 * one absolute peak (0..1) per fixed-size sample bucket, so the triage canvas
 * fills in as the audio streams. Pure — the UI owns throttling and drawing.
 */

export interface PeakState {
  peaks: number[] // one 0..1 peak per completed bucket
  carryMax: number // running |max| of the in-progress bucket (raw int16 scale)
  carryCount: number // samples accumulated in the in-progress bucket
}

export const newPeaks = (): PeakState => ({ peaks: [], carryMax: 0, carryCount: 0 })

/**
 * Fold a PCM chunk into the state. Partial buckets carry across chunk boundaries;
 * once `maxBuckets` is reached further samples are dropped (a bounded canvas can't
 * grow without limit on a looping preview).
 */
export function appendPeaks(
  state: PeakState,
  samples: Int16Array,
  samplesPerBucket: number,
  maxBuckets = 2000
): PeakState {
  if (samples.length === 0 || samplesPerBucket <= 0) return state
  const peaks = [...state.peaks]
  let { carryMax, carryCount } = state
  for (let i = 0; i < samples.length; i++) {
    if (peaks.length >= maxBuckets) break
    const a = Math.abs(samples[i])
    if (a > carryMax) carryMax = a
    if (++carryCount >= samplesPerBucket) {
      peaks.push(carryMax / 32768)
      carryMax = 0
      carryCount = 0
    }
  }
  return { peaks, carryMax, carryCount }
}
