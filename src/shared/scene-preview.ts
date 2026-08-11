/**
 * Maps a SceneDraft to a PreviewRequest for the GM-only preview bus (grimoire
 * Phase 4). Pure: the builder UI calls this and hands the result straight to
 * api.preview.start — auditioning a draft can never touch the live mix.
 */
import type { SceneDraft } from './scene-edit'
import type { PreviewLayer, PreviewRequest, Song } from './types'

/**
 * The draft's start track becomes the primary layer (layers[0], ends the preview
 * when it finishes); playing ambience layers follow by mode. Songs missing from
 * the library are filtered out — a stale draft auditions what it can instead of
 * failing. An all-missing draft yields `{ layers: [] }`; callers skip start().
 */
export function draftToPreviewRequest(
  draft: SceneDraft,
  songsById: Record<string, Song>
): PreviewRequest {
  const layers: PreviewLayer[] = []

  const currentSong = songsById[draft.songIds[draft.currentIndex] ?? '']
  if (currentSong) layers.push({ song: currentSong, volume: draft.musicVolume, loop: false })

  for (const layer of draft.ambience) {
    if (!layer.playing) continue
    const song = songsById[layer.songId]
    if (!song) continue
    if (layer.mode === 'random') {
      layers.push({
        song,
        volume: layer.volume,
        loop: false,
        random: { pool: [song], minSec: layer.minIntervalSec, maxSec: layer.maxIntervalSec }
      })
    } else {
      layers.push({ song, volume: layer.volume, loop: true })
    }
  }

  return { layers }
}
