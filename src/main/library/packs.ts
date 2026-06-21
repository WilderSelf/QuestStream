// Shareable scene / playlist "packs": a portable JSON document containing a scene
// or playlist plus the *metadata* of the songs it references — NEVER the audio
// bytes. Embedding copyrighted audio would be redistribution; keeping packs to
// metadata + source URLs is both legal and tiny. Songs are keyed by their stable
// `videoId` so a pack re-resolves cleanly on another machine (local-source songs
// import as placeholders the recipient re-links, since their media path is foreign).

import type { AmbienceMode, ItemKind, LibrarySnapshot, SceneAmbience, SourceType } from '../../shared/types'
import { clamp01 } from '../../shared/num'
import type { LibraryStore } from './store'

const PACK_VERSION = 1

export interface PackSong {
  videoId: string
  url: string
  title: string
  artistName: string
  albumTitle: string
  duration: number
  thumbnail?: string
  tags: string[]
  sourceType: SourceType
  effect?: string
  kind?: ItemKind
}

export interface ScenePack {
  kind: 'scene'
  version: number
  name: string
  songIds: string[] // videoIds
  musicVolume: number
  currentIndex: number
  ambience: SceneAmbience[] // songId / pool are videoIds in a pack
  songs: PackSong[]
}

export interface PlaylistPack {
  kind: 'playlist'
  version: number
  name: string
  songIds: string[] // videoIds
  songs: PackSong[]
}

export type Pack = ScenePack | PlaylistPack

function songMetaByVideoId(snap: LibrarySnapshot, internalIds: string[]): Map<string, PackSong> {
  const songById = new Map(snap.songs.map((s) => [s.id, s]))
  const artistById = new Map(snap.artists.map((a) => [a.id, a]))
  const albumById = new Map(snap.albums.map((a) => [a.id, a]))
  const out = new Map<string, PackSong>()
  for (const id of internalIds) {
    const song = songById.get(id)
    if (!song || out.has(song.videoId)) continue
    out.set(song.videoId, {
      videoId: song.videoId,
      url: song.url,
      title: song.title,
      artistName: artistById.get(song.artistId)?.name ?? 'Unknown Artist',
      albumTitle: albumById.get(song.albumId)?.title ?? 'Singles',
      duration: song.duration,
      thumbnail: song.thumbnail,
      tags: song.tags ?? [],
      sourceType: song.sourceType ?? 'youtube',
      effect: song.effect,
      kind: song.kind ?? 'track'
    })
  }
  return out
}

/** Build a portable scene pack from the library snapshot, or null if the scene is gone. */
export function buildScenePack(snap: LibrarySnapshot, sceneId: string): ScenePack | null {
  const scene = snap.scenes.find((s) => s.id === sceneId)
  if (!scene) return null
  const referenced = [
    ...scene.songIds,
    ...scene.ambience.flatMap((a) => [a.songId, ...(a.pool ?? [])])
  ]
  const meta = songMetaByVideoId(snap, referenced)
  const songById = new Map(snap.songs.map((s) => [s.id, s]))
  const toVid = (id: string): string | undefined => songById.get(id)?.videoId
  const vids = (ids: string[]): string[] => ids.map(toVid).filter((v): v is string => !!v)
  return {
    kind: 'scene',
    version: PACK_VERSION,
    name: scene.name,
    songIds: vids(scene.songIds),
    musicVolume: scene.musicVolume,
    currentIndex: scene.currentIndex,
    ambience: scene.ambience.map((a) => ({
      ...a,
      songId: toVid(a.songId) ?? '',
      pool: a.pool ? vids(a.pool) : undefined
    })),
    songs: [...meta.values()]
  }
}

/** Build a portable playlist pack, or null if the playlist is gone. */
export function buildPlaylistPack(snap: LibrarySnapshot, playlistId: string): PlaylistPack | null {
  const pl = snap.playlists.find((p) => p.id === playlistId)
  if (!pl) return null
  const meta = songMetaByVideoId(snap, pl.songIds)
  const songById = new Map(snap.songs.map((s) => [s.id, s]))
  const vids = pl.songIds.map((id) => songById.get(id)?.videoId).filter((v): v is string => !!v)
  return { kind: 'playlist', version: PACK_VERSION, name: pl.name, songIds: vids, songs: [...meta.values()] }
}

// Coerce an untrusted value through the shared clamp (non-numbers → 0, via Number.isFinite).
const clampVol = (n: unknown): number => clamp01(n as number)

function validatePackSong(raw: unknown): PackSong {
  if (!raw || typeof raw !== 'object') throw new Error('pack: invalid song entry')
  const r = raw as Record<string, unknown>
  if (typeof r.videoId !== 'string' || typeof r.url !== 'string') throw new Error('pack: song missing videoId/url')
  const st = r.sourceType
  const k = r.kind
  return {
    videoId: r.videoId,
    url: r.url,
    title: typeof r.title === 'string' ? r.title : 'Untitled',
    artistName: typeof r.artistName === 'string' ? r.artistName : 'Unknown Artist',
    albumTitle: typeof r.albumTitle === 'string' ? r.albumTitle : 'Singles',
    duration: typeof r.duration === 'number' && Number.isFinite(r.duration) ? r.duration : 0,
    thumbnail: typeof r.thumbnail === 'string' ? r.thumbnail : undefined,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    sourceType: st === 'local' || st === 'url' || st === 'youtube' ? st : 'youtube',
    effect: typeof r.effect === 'string' ? r.effect : undefined,
    kind: k === 'ambience' || k === 'sfx' || k === 'track' ? k : 'track'
  }
}

/**
 * Parse + validate untrusted pack JSON (a file from anyone). Throws on anything
 * malformed; never trusts shapes. Volumes are clamped; unknown keys ignored.
 */
export function validatePack(raw: unknown): Pack {
  if (!raw || typeof raw !== 'object') throw new Error('Not a valid pack file')
  const r = raw as Record<string, unknown>
  if (r.kind !== 'scene' && r.kind !== 'playlist') throw new Error('Unknown pack type')
  if (!Array.isArray(r.songs)) throw new Error('Pack has no songs')
  const songs = r.songs.map(validatePackSong)
  const songIds = Array.isArray(r.songIds) ? r.songIds.filter((s): s is string => typeof s === 'string') : []
  const name = typeof r.name === 'string' && r.name.trim() ? r.name : 'Imported'
  if (r.kind === 'playlist') {
    return { kind: 'playlist', version: PACK_VERSION, name, songIds, songs }
  }
  const ambienceRaw = Array.isArray(r.ambience) ? r.ambience : []
  const ambience: SceneAmbience[] = ambienceRaw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      songId: typeof a.songId === 'string' ? a.songId : '',
      volume: clampVol(a.volume),
      playing: a.playing !== false,
      mode: (a.mode === 'random' ? 'random' : 'loop') as AmbienceMode,
      pool: Array.isArray(a.pool) ? a.pool.filter((p): p is string => typeof p === 'string') : undefined,
      minIntervalSec: typeof a.minIntervalSec === 'number' ? a.minIntervalSec : undefined,
      maxIntervalSec: typeof a.maxIntervalSec === 'number' ? a.maxIntervalSec : undefined
    }))
    .filter((a) => a.songId)
  return {
    kind: 'scene',
    version: PACK_VERSION,
    name,
    songIds,
    musicVolume: clampVol(r.musicVolume),
    currentIndex: typeof r.currentIndex === 'number' && r.currentIndex >= 0 ? Math.floor(r.currentIndex) : 0,
    ambience,
    songs
  }
}

/**
 * Recreate a validated pack's songs (dedup by videoId — never clobbers an existing
 * song's tags/effect) and the scene/playlist that references them, with fresh ids.
 */
export function importPack(store: LibraryStore, pack: Pack): { kind: Pack['kind']; id: string; name: string } {
  const existing = new Set(store.snapshot().songs.map((s) => s.videoId))
  const vidToId = new Map<string, string>()
  for (const ps of pack.songs) {
    const song = store.addSong({
      videoId: ps.videoId,
      url: ps.url,
      title: ps.title,
      artistName: ps.artistName,
      albumTitle: ps.albumTitle,
      duration: ps.duration,
      thumbnail: ps.thumbnail,
      sourceType: ps.sourceType,
      kind: ps.kind ?? 'track'
    })
    vidToId.set(ps.videoId, song.id)
    // Only apply pack tags/effect to songs we just created — don't overwrite the
    // importer's own metadata on a song they already had.
    if (!existing.has(ps.videoId)) {
      if (ps.tags.length) store.retag(song.id, { tags: ps.tags })
      if (ps.effect) store.setEffect(song.id, ps.effect)
    }
  }
  const ids = (vids: string[]): string[] => vids.map((v) => vidToId.get(v)).filter((x): x is string => !!x)

  if (pack.kind === 'playlist') {
    const pl = store.savePlaylist(pack.name, ids(pack.songIds))
    return { kind: 'playlist', id: pl.id, name: pl.name }
  }
  const ambience: SceneAmbience[] = pack.ambience
    .map((a) => ({ ...a, songId: vidToId.get(a.songId) ?? '', pool: a.pool ? ids(a.pool) : undefined }))
    .filter((a) => a.songId)
  const scene = store.saveScene({
    name: pack.name,
    songIds: ids(pack.songIds),
    musicVolume: pack.musicVolume,
    currentIndex: pack.currentIndex,
    ambience
  })
  return { kind: 'scene', id: scene.id, name: scene.name }
}
