// Domain model + IPC contract shared between main, preload and renderer.

export interface Artist {
  id: string
  name: string
}

export interface Album {
  id: string
  artistId: string
  title: string
  thumbnail?: string
  year?: number
}

/**
 * Where a song's audio comes from. Additive — older libraries with no field are
 * migrated to 'youtube'. 'url' is any other yt-dlp-supported site (SoundCloud,
 * Bandcamp, direct media). 'local' is a file copied into the app's media dir, in
 * which case `url` is that absolute path (not an http URL) and `videoId` is
 * `local:<sha1>`.
 */
export type SourceType = 'youtube' | 'url' | 'local'

export interface Song {
  id: string
  albumId: string
  artistId: string
  title: string
  url: string // canonical source URL, or an absolute media path when sourceType==='local'
  videoId: string // dedup key; 'local:<sha1>' for local files
  duration: number // seconds
  thumbnail?: string
  tags: string[]
  addedAt: number
  enriched?: boolean // MusicBrainz enrichment attempted
  sourceType?: SourceType // undefined in old libraries → migrated to 'youtube'
  effect?: string // optional DSP preset key (see main/bot/effects.ts)
}

export interface Playlist {
  id: string
  name: string
  songIds: string[]
  createdAt: number
  updatedAt: number
}

/** A one-shot sound effect bound to a hotkey, triggerable over the mix. */
export interface SoundboardItem {
  id: string
  songId: string
  hotkey?: string // single-key binding, e.g. 'a', '1', 'F5'
  gain?: number // 0..1, default 1
  duckUnderMusic?: boolean // lower the music while this plays
}

/**
 * How an ambience layer plays:
 * - 'loop'   — seamless continuous loop (the original behaviour; default).
 * - 'random' — fire a random track from `pool` at a random interval in
 *              [minIntervalSec, maxIntervalSec] (organic one-shots: a wolf howl,
 *              a creaking timber). Immersive without a constant bed.
 */
export type AmbienceMode = 'loop' | 'random'

export interface SceneAmbience {
  songId: string
  volume: number
  playing: boolean
  mode?: AmbienceMode // undefined → 'loop'
  pool?: string[] // songIds for 'random' mode
  minIntervalSec?: number
  maxIntervalSec?: number
}

/** A full mix snapshot: the music queue + ambience layers + their volumes. */
export interface Scene {
  id: string
  name: string
  songIds: string[] // music queue
  musicVolume: number
  currentIndex: number // which queue track to start from on recall
  ambience: SceneAmbience[]
  createdAt: number
  updatedAt: number
}

export interface LibrarySnapshot {
  artists: Artist[]
  albums: Album[]
  songs: Song[]
  playlists: Playlist[]
  scenes: Scene[]
  soundboard: SoundboardItem[]
}

export interface ImportProgress {
  url: string
  status: 'resolving' | 'importing' | 'done' | 'error'
  message?: string
  total?: number
  completed?: number
  addedSongIds?: string[]
}

// ---- Discord ----

export interface GuildInfo {
  id: string
  name: string
  icon?: string
}

export interface VoiceChannelInfo {
  id: string
  name: string
  guildId: string
}

export type BotConnectionState = 'disconnected' | 'connecting' | 'ready' | 'error'

export interface BotStatus {
  state: BotConnectionState
  username?: string
  error?: string
  activeGuildId?: string
  activeChannelId?: string
}

// ---- Player ----

export type PlaybackState = 'idle' | 'buffering' | 'playing' | 'paused'

export interface PlayerStatus {
  state: PlaybackState
  songId?: string
  positionSec: number
  durationSec: number
  volume: number // 0..1
}

// ---- App notices (main → renderer toast) ----
export interface AppNotice {
  message: string
  kind: 'info' | 'error'
}

// ---- Remote control (LAN web remote / Stream Deck) ----
// The queue + scene logic lives in the renderer, so the remote server (in main)
// drives it: HTTP command → main → `remote:command` IPC → renderer store action.
// The renderer pushes this snapshot back to main for the `GET /api/state` endpoint.
export interface RemoteTrack {
  uid: string
  title: string
  current: boolean
}
export interface RemoteSceneRef {
  id: string
  name: string
}
export interface RemoteSfxRef {
  id: string
  label: string
  hotkey?: string
}
export interface RemoteState {
  playing: boolean
  paused: boolean
  ducking: boolean
  title: string | null
  positionSec: number
  durationSec: number
  volume: number
  queue: RemoteTrack[]
  scenes: RemoteSceneRef[]
  soundboard: RemoteSfxRef[]
}
export type RemoteCommand =
  | { action: 'togglePlay' }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'seek'; seconds: number }
  | { action: 'setVolume'; volume: number }
  | { action: 'duck'; on: boolean }
  | { action: 'recallScene'; id: string }
  | { action: 'triggerSfx'; id: string }
  | { action: 'playQueueItem'; uid: string }
export interface RemoteInfo {
  enabled: boolean
  port: number
  url: string | null // http://<lan-ip>:<port>/?pair=<one-time-code> (null when disabled)
  error?: string // set when enabling failed (e.g. port in use)
}

// ---- Re-tag payload ----
export interface RetagPayload {
  title?: string
  artistName?: string
  albumTitle?: string
  tags?: string[]
}
