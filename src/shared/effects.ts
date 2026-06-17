// The DSP effect presets a user can pick, shared by the renderer (the <select> in
// the track editor) and the main process (which maps each key to an ffmpeg filter
// in main/bot/effects.ts). Keep the keys in sync between the two files.

export interface EffectPreset {
  key: string
  label: string
}

export const EFFECT_PRESETS: EffectPreset[] = [
  { key: 'cavern', label: 'Cavern' },
  { key: 'telephone', label: 'Telephone' },
  { key: 'radio', label: 'Old Radio' },
  { key: 'underwater', label: 'Underwater' }
]
