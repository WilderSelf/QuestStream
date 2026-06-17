// DSP / "voice & space" effect presets applied per mixer input via ffmpeg's -af
// chain. Each preset is a small, fixed ffmpeg filter string. loudnorm always runs
// FIRST so normalization is measured on the dry signal, then the effect colours it.
//
// These run inside the same ffmpeg that already decodes the source (no extra
// process, no native code) — see Mixer.spawn(). Keep the values conservative so a
// preset never clips or balloons CPU.

const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11'

/** key → ffmpeg filtergraph fragment (appended after loudnorm). */
export const EFFECTS: Record<string, string> = {
  // Big stone room: a couple of decaying echoes.
  cavern: 'aecho=0.8:0.85:60|120:0.5|0.3',
  // Tinny phone/comms: band-limit to the classic 300–3400 Hz voice band.
  telephone: 'highpass=f=400,lowpass=f=3000',
  // Old radio: narrower band + a touch of drive for grit.
  radio: 'highpass=f=300,lowpass=f=3400,acompressor=threshold=0.1:ratio=4:makeup=2',
  // Muffled / submerged: roll off the highs and add slow movement.
  underwater: 'lowpass=f=700,chorus=0.6:0.9:55:0.4:0.25:2'
}

/**
 * Build the ffmpeg `-af` value for an input. Unknown/empty key → loudnorm only
 * (identical to the original behaviour), so this is safe for every existing song.
 */
export function buildAfChain(effect?: string): string {
  const extra = effect ? EFFECTS[effect] : undefined
  return extra ? `${LOUDNORM},${extra}` : LOUDNORM
}
