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

/**
 * Which library pane an item belongs to. Exclusive — set at import, drives which of
 * the three browser panes (Music / Ambience / Soundboard) the item appears in.
 * Additive: libraries with no field migrate to 'track' (see LibraryStore.load).
 */
export type ItemKind = 'track' | 'ambience' | 'sfx'

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
  sourceType?: SourceType // undefined in old libraries → migrated to 'youtube'
  effect?: string // optional DSP preset key (see main/bot/effects.ts)
  kind?: ItemKind // undefined in old libraries → migrated to 'track'
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

/** A soundboard pad that belongs to one scene (joins the global board while the scene plays). */
export interface ScenePad {
  songId: string
  hotkey?: string // single-key binding; beats a global soundboard binding on the same key
  gain?: number // 0..1, default 1
  duckUnderMusic?: boolean
}

/**
 * What happens when the scene's music list runs out:
 * - 'stop'      — silence after the last track.
 * - 'loop-list' — start the list over.
 * - 'loop-last' — keep looping the final track (holds a mood indefinitely).
 * - 'shuffle'   — keep playing random tracks from the list.
 * undefined → the player's current global repeat/shuffle settings apply (legacy behavior).
 */
export type EndOfListPolicy = 'stop' | 'loop-list' | 'loop-last' | 'shuffle'

/**
 * A scene: the music list + ambience layers + volumes, plus optional document fields
 * (grimoire redesign). Every field below `ambience` is optional so legacy scenes
 * load, recall, and re-save byte-identically.
 */
export interface Scene {
  id: string
  name: string
  songIds: string[] // music queue
  musicVolume: number
  currentIndex: number // which queue track to start from on recall
  ambience: SceneAmbience[]
  createdAt: number
  updatedAt: number
  note?: string // GM marginalia, shown when the scene opens
  pads?: ScenePad[]
  endOfList?: EndOfListPolicy
  crossfadeMs?: number // per-scene transition; undefined → engine default
  lastPlayedAt?: number // local metadata; stripped from exported packs
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

/**
 * Per-layer ambience progress, emitted on the heartbeat so each layer card can draw a
 * progress bar that mirrors the music transport:
 * - 'loop'   layers: position within the current loop (resets each cycle).
 * - 'random' layers: a countdown to the next one-shot — positionSec rises toward
 *            durationSec (the chosen interval), then resets when the shot fires.
 */
export interface AmbienceLayerStatus {
  slotId: string
  positionSec: number
  durationSec: number
}

// ---- Preview bus (GM-only audition; never touches the live mix) ----

/** Randomized one-shot scheduling for a preview ambience layer (mirrors SceneAmbience). */
export interface PreviewRandom {
  pool: Song[]
  minSec: number
  maxSec: number
}

/**
 * One layer of a preview mix. layers[0] is the primary (music) layer — it takes
 * `startSec` and its natural end stops the preview. When `random` is set the layer
 * plays one-shots drawn from the pool instead of `song`.
 */
export interface PreviewLayer {
  song: Song
  volume: number // 0..1
  loop: boolean
  random?: PreviewRandom
}

export interface PreviewRequest {
  layers: PreviewLayer[]
  startSec?: number
}

export interface PreviewStatus {
  playing: boolean
  positionSec: number
  durationSec: number // primary layer's song duration; 0 when unknown
}

// ---- App notices (main → renderer toast) ----
export interface AppNotice {
  message: string
  kind: 'info' | 'error'
  // A persistent/blocking condition (e.g. a missing external tool) renders as a sticky
  // banner that stays until the user dismisses it, instead of an auto-dismissing toast.
  persistent?: boolean
  // Tags a track-playback failure so the renderer can count them and, after a few,
  // suggest updating yt-dlp (the usual cause when YouTube changes break a stale build).
  code?: 'playback-failed'
}

// ---- External tools (yt-dlp / ffmpeg / ffprobe) ----
export type ToolName = 'yt-dlp' | 'ffmpeg' | 'ffprobe'
export interface ToolStatus {
  name: ToolName
  found: boolean
  path: string
  source: 'downloaded' | 'bundled' | 'system' | 'none'
}
export interface ToolUpdateResult {
  ok: boolean
  version?: string
  error?: string
}

// ---- YouTube cookies (to get past "confirm you're not a bot") ----
export type CookiesMode = 'none' | 'file' | 'browser'
// Browsers yt-dlp can read cookies from directly (allow-listed to avoid arg injection).
export const COOKIE_BROWSERS = [
  'firefox',
  'chrome',
  'chromium',
  'brave',
  'edge',
  'vivaldi',
  'opera',
  'safari'
] as const
export type CookieBrowser = (typeof COOKIE_BROWSERS)[number]
export interface CookiesStatus {
  mode: CookiesMode
  browser?: CookieBrowser
  hasFile: boolean // an imported cookies.txt exists in app data
}

// ---- Desktop integration (AppImage → applications menu) ----
export interface DesktopStatus {
  isAppImage: boolean // running as an AppImage (so a menu entry can be installed)
  installed: boolean // a .desktop entry already exists
}

// ---- Auto-update (electron-updater) ----
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
export interface UpdateState {
  phase: UpdatePhase
  version?: string // the version being offered/downloaded
  percent?: number // download progress (0–100) while phase === 'downloading'
  message?: string // error detail when phase === 'error'
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
  kind?: ItemKind // re-classify the item into another pane
}
