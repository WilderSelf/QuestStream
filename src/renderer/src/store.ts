import { create } from 'zustand'
import { localMonitor } from './monitor'
import { previewPlayer } from './preview-player'
import type {
  LibrarySnapshot,
  Song,
  BotStatus,
  PlayerStatus,
  GuildInfo,
  VoiceChannelInfo,
  ImportProgress,
  AmbienceMode,
  AmbienceLayerStatus,
  RemoteCommand,
  RemoteState,
  ItemKind,
  DesktopStatus,
  PreviewRequest,
  PreviewStatus
} from '@shared/types'
import { defaultGroupBy, normalizeTag, KIND_ORDER } from '@shared/taxonomy'
import { resolveKey, scenePadTriggerId } from '@shared/keymap'
import { nextQueueIndex } from '@shared/queue-policy'
import { buildRecallPlan, type RecallOptions, type RecallPlan } from '@shared/scene-recall'
import { reduceImportRows, type ImportRow } from '@shared/import-flow'
import {
  newTriage,
  reduceTriage,
  triageComplete,
  type TriageAction,
  type TriageState
} from '@shared/triage'
import { DEFAULT_CROSSFADE_MS } from '@shared/num'
import {
  newDraft,
  reduceDraft,
  draftToSceneInput,
  type SceneDraft,
  type DraftAction
} from '@shared/scene-edit'
import { NORD_SWATCH_HEX, migrateTagColor } from '@shared/tagColors'
import type { SwatchTable } from '@shared/tagColors'
import { clamp01 } from '@shared/num'
import { DEFAULT_VOLUME } from '@shared/constants'

/**
 * Per-track loop, set on the queue card:
 * - 'off'  — play through, then advance (default).
 * - 'on'   — loop this track forever (until changed or skipped).
 * - 'once' — on natural end, replay once more, then continue to the next track.
 * Takes precedence over the global `repeat` mode when a track ends on its own.
 */
export type LoopMode = 'off' | 'on' | 'once'

export interface QueueItem {
  uid: string
  song: Song
  loop?: LoopMode // undefined → 'off'
}

export type RepeatMode = 'off' | 'all' | 'one'

/** Which section the Settings modal shows. Surfaced so the top-bar Remote button can open
 *  the modal straight to the Remote tab. */
/** Center workspaces of the grimoire shell; the union grows as phases land. */
export type Workspace = 'library' | 'builder' | 'scene' | 'import' | 'triage'

export type SettingsTab = 'general' | 'display' | 'audio' | 'remote' | 'advanced'
export interface Notice {
  text: string
  kind: 'info' | 'error'
}
export interface AmbienceSlot {
  id: string
  song: Song // exactly one sound per layer
  volume: number
  playing: boolean
  mode: AmbienceMode // 'loop' (continuous) or 'random' (fire this sound every min–max sec)
  minSec: number
  maxSec: number
}

let uidSeq = 0
const newUid = (): string => `q${Date.now()}_${uidSeq++}`

// Draggable-layout split fractions (the leading pane's share of two adjacent panes). Defaults
// mirror the old fixed grid ratios; clamped so neither pane can be dragged to nothing.
const BROWSER_SPLIT_DEFAULT = 1.7 / (1.7 + 1.2) // Library's share of Library+Mix (~0.586)
const MIX_SPLIT_DEFAULT = 0.62 // Now Playing's share of NowPlaying+Ambience (it's the primary pane)
const SPLIT_MIN = 0.2
const SPLIT_MAX = 0.8
const clampSplit = (v: number): number => Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, v))
// Scenes/Playlists rail width in px (when expanded); the collapsed 48px strip is CSS-driven.
const RAIL_WIDTH_DEFAULT = 200
const RAIL_MIN = 140
const RAIL_MAX = 360
const clampRail = (v: number): number => Math.max(RAIL_MIN, Math.min(RAIL_MAX, v))

// UI scale (webFrame zoom factor). Bounds enclose the Display-tab presets (90–150%).
const UI_SCALE_MIN = 0.8
const UI_SCALE_MAX = 1.5
const clampScale = (v: number): number =>
  Number.isFinite(v) ? Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, v)) : 1
/** Apply the text-only scale as a CSS var on :root (multiplies the --text-* tokens). */
const applyTextScale = (scale: number): void => {
  document.documentElement.style.setProperty('--text-scale', String(scale))
}
/** Built-in themes, in picker order. `id` is the `data-theme` value; the default (nord-refined)
 *  is the bare :root, so it needs no attribute. `swatch` is a [ground, primary] preview pair. */
export const DEFAULT_THEME = 'nord-refined'
export const BUILTIN_THEMES: { id: string; name: string; swatch: [string, string] }[] = [
  { id: 'nord-refined', name: 'Nord Refined', swatch: ['#1b2028', '#e8a95e'] },
  { id: 'torchlit', name: 'Torchlit', swatch: ['#1a1512', '#eab963'] },
  { id: 'daylight', name: 'Daylight', swatch: ['#e5e9f0', '#b06e26'] }
]
/** Apply a theme by name: the default is the bare :root (no attribute); everything else is a
 *  `[data-theme="<name>"]` block (built-in, compiled into styles.css; or user, injected below). */
const applyThemeAttr = (name: string): void => {
  if (name === DEFAULT_THEME) document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', name)
}
const isBuiltinTheme = (name: string): boolean => BUILTIN_THEMES.some((t) => t.id === name)
/** Host the active USER theme's CSS. Any token it omits falls back to the base :root (Nord
 *  Refined) via the cascade, so a partial or malformed sheet can't break the UI. */
const setUserThemeCss = (css: string): void => {
  const id = 'qs-user-theme'
  let el = document.getElementById(id) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = css
}

/** The swatch keys read from the active theme's `--tag-*` tokens (plus 'neutral'). */
const SWATCH_TOKEN_KEYS = [...Object.keys(NORD_SWATCH_HEX)]
/** Snapshot the active theme's tag swatch palette from CSS, falling back per-token to Nord so a
 *  theme that omits a swatch (or a headless environment with no layout) still resolves. */
const readThemeSwatches = (): SwatchTable => {
  if (typeof document === 'undefined') return { ...NORD_SWATCH_HEX }
  const cs = getComputedStyle(document.documentElement)
  const out: SwatchTable = {}
  for (const key of SWATCH_TOKEN_KEYS) {
    out[key] = cs.getPropertyValue(`--tag-${key}`).trim() || NORD_SWATCH_HEX[key]
  }
  return out
}
/** Parse a persisted split fraction, throwing on a non-finite value so readLocal uses its default. */
const parseSplit = (s: string): number => {
  const n = parseFloat(s)
  if (!Number.isFinite(n)) throw new Error('invalid split')
  return clampSplit(n)
}

/** Read a persisted preference, falling back if the key is missing or localStorage throws. */
function readLocal<T>(key: string, parse: (raw: string) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : parse(raw)
  } catch {
    return fallback
  }
}
/** Persist any JSON-serialisable preference (a no-op if localStorage is unavailable). */
function persistJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage unavailable — preference just won't persist */
  }
}
/** Persist the tag-colour override map (a no-op if localStorage is unavailable). */
function persistTagColors(colors: Record<string, string>): void {
  try {
    localStorage.setItem('qs.tagColors', JSON.stringify(colors))
  } catch {
    /* localStorage unavailable — preference just won't persist */
  }
}

let initialized = false // guard against React StrictMode double-invoking init() (double IPC subs)
let noticeSeq = 0
let slotSeq = 0
let draftSeq = 0
const newSlotId = (): string => `amb${Date.now()}_${slotSeq++}`

/** Leading+trailing throttle (renderer-only; Date.now is fine here). */
function throttle(fn: () => void, ms: number): () => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    const now = Date.now()
    const remaining = ms - (now - last)
    if (remaining <= 0) {
      last = now
      fn()
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now()
        timer = null
        fn()
      }, remaining)
    }
  }
}

/** Snapshot the bits of renderer state the remote needs (served at /api/state). */
function buildRemoteState(s: State): RemoteState {
  const current = s.queue.find((q) => q.uid === s.currentUid)?.song
  const songById = new Map(s.library.songs.map((x) => [x.id, x]))
  return {
    playing: s.player.state === 'playing' || s.player.state === 'buffering',
    paused: s.player.state === 'paused',
    ducking: s.ducking,
    title: current?.title ?? null,
    positionSec: s.player.positionSec,
    durationSec: current?.duration ?? s.player.durationSec ?? 0,
    volume: s.player.volume,
    queue: s.queue.map((q) => ({ uid: q.uid, title: q.song.title, current: q.uid === s.currentUid })),
    scenes: s.library.scenes.map((sc) => ({ id: sc.id, name: sc.name })),
    soundboard: s.library.soundboard.map((sb) => ({
      id: sb.id,
      label: songById.get(sb.songId)?.title ?? 'sound',
      hotkey: sb.hotkey
    }))
  }
}

/** Execute a command arriving from the remote, exactly like the equivalent UI action. */
function handleRemoteCommand(s: State, c: RemoteCommand): void {
  switch (c.action) {
    case 'togglePlay': void s.togglePlay(); break
    case 'pause': void window.api.player.pause(); break
    case 'resume': void window.api.player.resume(); break
    case 'next': void s.playNext(); break
    case 'prev': void s.playPrev(); break
    case 'seek': void s.seekTo(c.seconds); break
    case 'setVolume': s.setMasterVolume(c.volume); break // controls the Discord SEND level only, never the GM's local monitor
    case 'duck': s.setDuck(c.on); break
    case 'recallScene': s.recallScene(c.id); break
    case 'triggerSfx': s.triggerSfx(c.id); break
    case 'playQueueItem': void s.playUid(c.uid); break
  }
}

/** Push an ambience slot's current mode/volume to the audio engine. */
function applyAmbience(slot: AmbienceSlot): void {
  if (!slot.playing) {
    void window.api.ambience.stop(slot.id)
    return
  }
  if (slot.mode === 'random') {
    // One sound per layer: fire just this layer's sound at the chosen interval.
    void window.api.ambience.playRandom(slot.id, [slot.song], slot.volume, slot.minSec, slot.maxSec)
  } else {
    void window.api.ambience.play(slot.id, slot.song, slot.volume)
  }
}

interface State {
  library: LibrarySnapshot
  selectedArtistId: string | null
  selectedAlbumId: string | null

  queue: QueueItem[]
  currentUid: string | null
  selectedUid: string | null
  loadedPlaylistId: string | null

  player: PlayerStatus
  bot: BotStatus
  guilds: GuildInfo[]
  channels: VoiceChannelInfo[]
  selectedGuildId: string | null
  selectedChannelId: string | null

  importStatus: ImportProgress | null
  notice: Notice | null
  blockingAlert: string | null // sticky banner for a blocking condition (e.g. missing yt-dlp)
  botErrorDismissed: string | null // the Discord-error text the user has dismissed from the banner
  updatingYtdlp: boolean // a yt-dlp download is in progress
  playbackFailures: number // consecutive track failures (reset on a successful play)
  suggestYtdlpUpdate: boolean // after repeated failures, offer an "Update yt-dlp" banner
  settingsOpen: boolean
  settingsTab: SettingsTab
  uiScale: number // renderer zoom factor (whole-UI scale), 0.8–1.5
  textScale: number // text-only multiplier over the --text-* tokens (layout unchanged), 0.8–1.5
  savePromptOpen: boolean
  saveScenePromptOpen: boolean
  loadedSceneId: string | null

  search: string
  editSongId: string | null
  shuffle: boolean
  repeat: RepeatMode

  // library browser (tag-faceted, type-based)
  kindTab: ItemKind // which of Music / Ambience / Soundboard is shown
  groupBy: Record<ItemKind, string> // accordion grouping dimension, per kind
  activeFilters: Record<ItemKind, Record<string, string | null>> // secondary chip filters
  showArtistView: boolean // optional legacy Artist→Album→Song mode
  browserSplit: number // Library's fraction of the Library+Mix columns (draggable divider)
  mixSplit: number // Now Playing's fraction of the NowPlaying+Ambience rows (draggable divider)
  railWidth: number // Scenes/Playlists rail width in px when expanded (draggable divider)
  playlistsCollapsed: boolean // Scenes/Playlists rail collapsed to a slim icon strip
  tagColors: Record<string, string> // user colour overrides (swatch key or custom hex), keyed by normalized tag
  theme: string // active theme id ('nord-refined' default, a built-in id, or a user-theme file stem)
  themeSwatches: SwatchTable // active theme's tag palette, read from the --tag-* CSS tokens
  userThemes: string[] // user-authored theme stems discovered in userData/themes

  ambience: AmbienceSlot[]
  ambienceProgress: Record<string, { positionSec: number; durationSec: number }> // per-slot, from the heartbeat
  musicVolume: number
  monitorEnabled: boolean
  monitorVolume: number // independent local-monitor level (the Discord SEND level lives in player.volume)
  outputDeviceId: string // chosen local output device ('' = system default)
  ducking: boolean
  remoteActive: boolean // is the LAN remote enabled (gates state pushes)
  workspace: Workspace // which center workspace is open
  // Scene drafts (grimoire): editable working copies, keyed by sceneId or 'new:<n>'.
  // Editing a draft never touches the live mix; persisted so drafts survive restarts.
  sceneDrafts: Record<string, SceneDraft>
  // Preview bus (GM-only audition): last status heartbeat, null = nothing previewing.
  previewStatus: PreviewStatus | null
  // The draft open in the scene builder (a sceneId or 'new:<n>' key); null = closed.
  builderKey: string | null
  // The scene open on the scene page; null = closed.
  scenePageId: string | null
  // Import workbench: arriving-items rows, a pure fold of importProgress events.
  importRows: ImportRow[]
  // Tag triage (audition-first tagging); null = not triaging.
  triage: TriageState | null
  // Mirrors of the triage tag input for the keymap (Enter-on-empty = save & next).
  triageInputFocused: boolean
  triageInputEmpty: boolean

  // actions
  init: () => Promise<void>
  setWorkspace: (w: Workspace) => void
  openDraft: (sceneId?: string) => string // returns the draft key
  editDraft: (key: string, action: DraftAction) => void
  discardDraft: (key: string) => void
  saveDraft: (key: string) => Promise<void>
  startPreview: (request: PreviewRequest) => Promise<void>
  stopPreview: () => Promise<void>
  openBuilder: (sceneIdOrKey?: string) => void
  closeBuilder: () => void
  openScenePage: (sceneId: string) => void
  closeScenePage: () => void
  startTriage: (songIds: string[]) => void
  triageAct: (action: TriageAction) => void
  triagePreviewToggle: () => void
  exitTriage: () => void
  setTriageInput: (focused: boolean, empty: boolean) => void
  setRemoteActive: (on: boolean) => void
  selectArtist: (id: string) => void
  selectAlbum: (id: string) => void
  setSearch: (q: string) => void
  setEditSong: (songId: string | null) => void
  showNotice: (text: string, kind?: Notice['kind'], persistent?: boolean) => void
  dismissNotice: () => void
  dismissAlert: () => void
  dismissBotError: () => void
  updateYtdlp: () => Promise<void>
  installDesktopMenu: () => Promise<{ ok: boolean; error?: string; status?: DesktopStatus }>
  notePlaybackFailure: () => void
  dismissYtdlpSuggestion: () => void

  setKindTab: (kind: ItemKind) => void
  setGroupBy: (kind: ItemKind, dim: string) => void
  setKindFilter: (kind: ItemKind, dim: string, value: string | null) => void
  clearKindFilters: (kind: ItemKind) => void
  setBrowserSplit: (frac: number) => void
  setMixSplit: (frac: number) => void
  setRailWidth: (px: number) => void
  toggleArtistView: () => void
  togglePlaylistsCollapsed: () => void

  addAmbience: (song: Song) => void
  removeAmbience: (slotId: string) => void
  toggleAmbience: (slotId: string) => void
  setAmbienceVolume: (slotId: string, volume: number) => void
  setAmbienceMode: (slotId: string, mode: AmbienceMode) => void
  setAmbienceInterval: (slotId: string, minSec: number, maxSec: number) => void
  triggerSfx: (soundboardId: string) => void
  setDuck: (on: boolean) => void
  setMusicVolume: (volume: number) => void
  setMasterVolume: (volume: number) => void // Discord SEND level (what remote players hear)
  setMonitorVolume: (volume: number) => void // local MONITOR level (what the GM hears on this machine)
  setTagColor: (tag: string, value: string) => void // override a tag's colour (swatch key or custom hex)
  resetTagColor: (tag: string) => void // clear an override, reverting to the default
  refreshThemeSwatches: () => void // re-read the --tag-* tokens after a theme change
  setTheme: (name: string) => void // switch the active theme (applies, persists, re-reads swatches)
  reloadThemes: () => void // re-scan userData/themes for user-authored .css themes
  revealThemesFolder: () => void // open the themes folder in the OS file manager
  setOutputDevice: (deviceId: string) => void
  setMonitor: (on: boolean) => void
  toggleMonitor: () => void

  enqueueSongs: (songs: Song[], atIndex?: number) => void
  removeFromQueue: (uid: string) => void
  cycleQueueLoop: (uid: string) => void
  reorderQueue: (from: number, to: number) => void
  clearQueue: () => void
  loadPlaylist: (playlistId: string) => void
  selectQueueItem: (uid: string) => void

  playUid: (uid: string) => Promise<void>
  togglePlayUid: (uid: string) => Promise<void>
  seekTo: (seconds: number) => Promise<void>
  playNext: (auto?: boolean) => Promise<void>
  playPrev: () => Promise<void>
  togglePlay: () => Promise<void>
  toggleShuffle: () => void
  cycleRepeat: () => void

  setSettingsOpen: (open: boolean) => void
  openSettings: (tab?: SettingsTab) => void
  setUiScale: (scale: number) => void
  setTextScale: (scale: number) => void
  setSavePromptOpen: (open: boolean) => void
  setSaveScenePromptOpen: (open: boolean) => void
  saveScene: (name: string, id?: string) => Promise<void>
  recallScene: (sceneId: string) => void
  playScene: (sceneId: string, opts?: RecallOptions) => void
  applyRecallPlan: (sceneId: string | null, plan: RecallPlan) => void
  refreshGuilds: () => Promise<void>
  selectGuild: (id: string) => Promise<void>
  selectChannel: (id: string) => void
}

const EMPTY_LIB: LibrarySnapshot = {
  artists: [],
  albums: [],
  songs: [],
  playlists: [],
  scenes: [],
  soundboard: []
}
const IDLE_PLAYER: PlayerStatus = {
  state: 'idle',
  positionSec: 0,
  durationSec: 0,
  volume: DEFAULT_VOLUME
}

export const useStore = create<State>((set, get) => ({
  library: EMPTY_LIB,
  selectedArtistId: null,
  selectedAlbumId: null,
  queue: [],
  currentUid: null,
  selectedUid: null,
  loadedPlaylistId: null,
  player: IDLE_PLAYER,
  bot: { state: 'disconnected' },
  guilds: [],
  channels: [],
  selectedGuildId: null,
  selectedChannelId: null,
  importStatus: null,
  notice: null,
  blockingAlert: null,
  botErrorDismissed: null,
  updatingYtdlp: false,
  playbackFailures: 0,
  suggestYtdlpUpdate: false,
  settingsOpen: false,
  settingsTab: 'general',
  uiScale: readLocal('qs.uiScale', (s) => clampScale(parseFloat(s)), 1),
  textScale: readLocal('qs.textScale', (s) => clampScale(parseFloat(s)), 1),
  savePromptOpen: false,
  saveScenePromptOpen: false,
  loadedSceneId: null,
  search: '',
  editSongId: null,
  shuffle: false,
  repeat: 'off',
  // Library view state persists across restarts so you land back where you left off. Each read
  // validates/normalises against the current kinds so a stale or malformed value can't wedge the UI.
  kindTab: readLocal<ItemKind>(
    'qs.kindTab',
    (s) => {
      const k = JSON.parse(s)
      return KIND_ORDER.includes(k) ? k : 'track'
    },
    'track'
  ),
  groupBy: readLocal<Record<ItemKind, string>>(
    'qs.groupBy',
    (s) => {
      const p = JSON.parse(s) as Partial<Record<ItemKind, string>>
      return {
        track: p.track ?? defaultGroupBy('track'),
        ambience: p.ambience ?? defaultGroupBy('ambience'),
        sfx: p.sfx ?? defaultGroupBy('sfx')
      }
    },
    { track: defaultGroupBy('track'), ambience: defaultGroupBy('ambience'), sfx: defaultGroupBy('sfx') }
  ),
  activeFilters: readLocal<Record<ItemKind, Record<string, string | null>>>(
    'qs.activeFilters',
    (s) => {
      const p = JSON.parse(s) as Partial<Record<ItemKind, Record<string, string | null>>>
      return { track: p.track ?? {}, ambience: p.ambience ?? {}, sfx: p.sfx ?? {} }
    },
    { track: {}, ambience: {}, sfx: {} }
  ),
  showArtistView: false,
  browserSplit: readLocal('qs.browserSplit', (s) => parseSplit(s), BROWSER_SPLIT_DEFAULT),
  mixSplit: readLocal('qs.mixSplit', (s) => parseSplit(s), MIX_SPLIT_DEFAULT),
  railWidth: readLocal(
    'qs.railWidth',
    (s) => {
      const n = parseFloat(s)
      if (!Number.isFinite(n)) throw new Error('invalid rail width')
      return clampRail(n)
    },
    RAIL_WIDTH_DEFAULT
  ),
  playlistsCollapsed: readLocal('qs.playlistsCollapsed', (s) => s === '1', false),
  // persistJson stores the name JSON-encoded, so parse it back (a bare legacy value throws → default).
  theme: readLocal('qs.theme', (s) => String(JSON.parse(s)) || DEFAULT_THEME, DEFAULT_THEME),
  themeSwatches: readThemeSwatches(),
  userThemes: [],
  tagColors: readLocal<Record<string, string>>(
    'qs.tagColors',
    (raw) => {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return {}
      // Migrate legacy raw-hex overrides to swatch keys so existing tags follow the theme.
      return Object.fromEntries(
        Object.entries(parsed as Record<string, string>).map(([k, v]) => [k, migrateTagColor(v)])
      )
    },
    {}
  ),
  ambience: [],
  ambienceProgress: {},
  musicVolume: 1,
  monitorEnabled: false,
  monitorVolume: readLocal(
    'qs.monitorVolume',
    (s) => (Number.isFinite(parseFloat(s)) ? clamp01(parseFloat(s)) : DEFAULT_VOLUME),
    DEFAULT_VOLUME
  ),
  outputDeviceId: readLocal('qs.outputDeviceId', (s) => s, ''),
  ducking: false,
  remoteActive: false,
  workspace: 'library',
  sceneDrafts: readLocal('qs.sceneDrafts', (raw) => JSON.parse(raw) as Record<string, SceneDraft>, {}),
  previewStatus: null,
  builderKey: null,
  scenePageId: null,
  importRows: [],
  triage: null,
  triageInputFocused: false,
  triageInputEmpty: true,

  setRemoteActive: (on) => set({ remoteActive: on }),
  setWorkspace: (w) => set({ workspace: w }),

  // ---- Scene drafts (grimoire Phase 2): pure logic lives in @shared/scene-edit;
  // this slice is glue + persistence. Nothing here calls player/ambience IPC.
  openDraft: (sceneId) => {
    const { sceneDrafts, library } = get()
    const key = sceneId ?? `new:${Date.now()}_${draftSeq++}`
    if (sceneDrafts[key]) return key
    const from = sceneId ? library.scenes.find((sc) => sc.id === sceneId) : undefined
    const drafts = { ...sceneDrafts, [key]: newDraft(from) }
    set({ sceneDrafts: drafts })
    persistJson('qs.sceneDrafts', drafts)
    return key
  },
  editDraft: (key, action) => {
    const { sceneDrafts } = get()
    const draft = sceneDrafts[key]
    if (!draft) return
    const drafts = { ...sceneDrafts, [key]: reduceDraft(draft, action) }
    set({ sceneDrafts: drafts })
    persistJson('qs.sceneDrafts', drafts)
  },
  discardDraft: (key) => {
    const drafts = { ...get().sceneDrafts }
    delete drafts[key]
    set({ sceneDrafts: drafts })
    persistJson('qs.sceneDrafts', drafts)
  },
  saveDraft: async (key) => {
    const draft = get().sceneDrafts[key]
    if (!draft) return
    await window.api.scenes.save(draftToSceneInput(draft))
    get().discardDraft(key) // saved: the scene document is now the source of truth
  },

  // ---- preview bus (GM-only audition; never the live mix) ----
  startPreview: async (request) => {
    // Bring the local output up BEFORE asking main to start, so the ~250ms worklet
    // prime overlaps the yt-dlp/ffmpeg spin-up instead of following it.
    previewPlayer.setVolume(get().monitorVolume)
    void previewPlayer.setSinkId(get().outputDeviceId)
    void previewPlayer.start()
    await window.api.preview.start(request)
  },
  stopPreview: async () => {
    await window.api.preview.stop()
    previewPlayer.stop()
  },

  // ---- scene builder workspace (edits drafts + preview bus only — never the live mix) ----
  openBuilder: (sceneIdOrKey) => {
    const key = get().openDraft(sceneIdOrKey)
    set({ builderKey: key, workspace: 'builder' })
  },
  closeBuilder: () => {
    void get().stopPreview()
    set({ builderKey: null, workspace: 'library' })
  },

  // ---- tag triage (audition-first tagging over the preview bus) ----
  startTriage: (songIds) => {
    if (songIds.length === 0) return
    const first = get().library.songs.find((s) => s.id === songIds[0])
    set({
      triage: newTriage(songIds, { kind: first?.kind ?? 'track' }),
      workspace: 'triage',
      triageInputFocused: false,
      triageInputEmpty: true
    })
    // Audition-first: the first item starts playing (GM-only) immediately.
    if (first) void get().startPreview({ layers: [{ song: first, volume: 1, loop: false }] })
  },
  triageAct: (action) => {
    const t = get().triage
    if (!t) return
    // The save side-effect fires from the state being advanced FROM.
    if (action.type === 'save-next' && !triageComplete(t)) {
      void window.api.library.retag(t.queue[t.index], {
        tags: t.workingTags,
        kind: t.workingKind
      })
    }
    const next = reduceTriage(t, action)
    set({ triage: next })
    if (action.type === 'save-next' || action.type === 'skip') {
      const nextSong = triageComplete(next)
        ? undefined
        : get().library.songs.find((s) => s.id === next.queue[next.index])
      if (nextSong) void get().startPreview({ layers: [{ song: nextSong, volume: 1, loop: false }] })
      else void get().stopPreview()
    }
  },
  triagePreviewToggle: () => {
    const t = get().triage
    if (!t || triageComplete(t)) return
    if (get().previewStatus?.playing) {
      void get().stopPreview()
      return
    }
    const song = get().library.songs.find((s) => s.id === t.queue[t.index])
    if (song) void get().startPreview({ layers: [{ song, volume: 1, loop: false }] })
  },
  exitTriage: () => {
    void get().stopPreview()
    set({ triage: null, workspace: 'library' })
  },
  setTriageInput: (focused, empty) =>
    set({ triageInputFocused: focused, triageInputEmpty: empty }),

  // ---- scene page: opening a scene READS it; no audio side effects ----
  openScenePage: (sceneId) => set({ scenePageId: sceneId, workspace: 'scene' }),
  closeScenePage: () => {
    void get().stopPreview()
    set({ scenePageId: null, workspace: 'library' })
  },

  init: async () => {
    if (initialized) return // run once even under StrictMode's double-mount
    initialized = true
    const library = await window.api.library.get()
    set({ library })
    get().reloadThemes() // discover user-authored themes for the picker

    window.api.library.onChanged((snap) => set({ library: snap }))
    window.api.library.onImportProgress((p) => {
      set({ importStatus: p, importRows: reduceImportRows(get().importRows, p) })
      if (p.status === 'done' || p.status === 'error') {
        setTimeout(() => {
          if (get().importStatus === p) set({ importStatus: null })
        }, 4000)
      }
    })
    window.api.discord.onStatus((s) => {
      const prev = get().bot
      set({ bot: s })
      // A fresh/changed error (or recovery) should re-show the banner even if a prior
      // one was dismissed.
      if (s.error !== prev.error) set({ botErrorDismissed: null })
      if (s.state === 'ready') void get().refreshGuilds()

      const wasInChannel = !!prev.activeChannelId
      const nowInChannel = !!s.activeChannelId
      if (nowInChannel && !wasInChannel) {
        // joined a voice channel → output goes to Discord; drop local monitor.
        // (The mixer persists across join/leave, so playback hands over seamlessly.)
        get().setMonitor(false)
      } else if (!nowInChannel && wasInChannel) {
        // left the channel → keep playing locally (jukebox)
        get().setMonitor(true)
      }
    })
    window.api.player.onStatus((s) => {
      set({ player: s })
      // A track that actually starts playing clears the failure streak + any suggestion.
      if (s.state === 'playing') set({ playbackFailures: 0, suggestYtdlpUpdate: false })
    })
    window.api.player.onEnded(() => void get().playNext(true))
    window.api.ambience.onStatus((layers: AmbienceLayerStatus[]) => {
      const progress: Record<string, { positionSec: number; durationSec: number }> = {}
      for (const l of layers) progress[l.slotId] = { positionSec: l.positionSec, durationSec: l.durationSec }
      set({ ambienceProgress: progress })
    })
    window.api.monitor.onPcm((pcm) => {
      if (get().monitorEnabled) localMonitor.feed(pcm)
    })
    window.api.preview.onPcm((pcm) => previewPlayer.feed(pcm))
    window.api.preview.onStatus((s: PreviewStatus) => {
      set({ previewStatus: s })
      // Natural end (or a main-side stop): release the audio device + context.
      if (!s.playing) previewPlayer.stop()
    })
    window.api.app.onNotice((n) => {
      if (n.code === 'playback-failed') get().notePlaybackFailure()
      get().showNotice(n.message, n.kind, n.persistent)
    })

    // Remote control: execute incoming commands, and push state snapshots (throttled)
    // so the LAN web remote / Stream Deck can reflect now-playing, scenes and soundboard.
    // Only push while the remote is actually enabled (toggling it flips remoteActive,
    // which itself triggers the subscription → an immediate first push).
    window.api.remote.onCommand((c) => handleRemoteCommand(get(), c))
    const pushRemote = throttle(() => {
      if (get().remoteActive) window.api.remote.pushState(buildRemoteState(get()))
    }, 800)
    useStore.subscribe(pushRemote)
    void window.api.remote.getInfo().then((i) => set({ remoteActive: i.enabled }))

    // Global hotkeys, all routed through the pure resolver (@shared/keymap): bound
    // soundboard keys, F1–F8 scene recall, and hold-D ducking. Ignored while typing in
    // a field or rebinding a key (the bind UI sets a flag on window). User bindings on
    // a built-in key claim it entirely — precedence lives in resolveKey, not here.
    const dispatchKey = (e: KeyboardEvent, type: 'down' | 'up'): void => {
      if ((window as unknown as { __sbBinding?: boolean }).__sbBinding) return
      const el = document.activeElement
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      const s = get()
      const action = resolveKey(
        {
          key: e.key,
          type,
          meta: e.metaKey,
          ctrl: e.ctrlKey,
          alt: e.altKey,
          repeat: e.repeat,
          typing
        },
        {
          sceneIds: s.library.scenes.map((sc) => sc.id),
          soundboardHotkeys: s.library.soundboard
            .filter((sb) => sb.hotkey)
            .map((sb) => ({ key: sb.hotkey!, id: sb.id })),
          scenePadHotkeys: (() => {
            const sc = s.loadedSceneId
              ? s.library.scenes.find((x) => x.id === s.loadedSceneId)
              : undefined
            return (sc?.pads ?? []).flatMap((p, i) =>
              p.hotkey ? [{ key: p.hotkey, id: scenePadTriggerId(sc!.id, i) }] : []
            )
          })(),
          ...(s.workspace === 'triage' && s.triage
            ? { triage: { inputFocused: s.triageInputFocused, inputEmpty: s.triageInputEmpty } }
            : {})
        }
      )
      if (!action) return
      e.preventDefault()
      switch (action.kind) {
        case 'sfx':
          s.triggerSfx(action.id)
          break
        case 'scene-pad':
          s.triggerSfx(action.id) // same channel; main parses the scenepad: id
          break
        case 'duck':
          s.setDuck(action.down)
          break
        case 'recall-scene':
          // Direct one-press recall, no confirm: scenes are durable documents now
          // (nothing is lost by switching), and the F-keys exist for speed.
          s.recallScene(action.sceneId)
          break
        case 'triage-preview-toggle':
          s.triagePreviewToggle()
          break
        case 'triage-save-next':
          s.triageAct({ type: 'save-next' })
          break
        case 'triage-skip':
          s.triageAct({ type: 'skip' })
          break
      }
    }
    window.addEventListener('keydown', (e) => dispatchKey(e, 'down'))
    window.addEventListener('keyup', (e) => dispatchKey(e, 'up'))

    // Not in a voice channel yet → behave like a local jukebox (monitor on).
    get().setMonitor(true)

    // auto-connect if a token already exists
    if (await window.api.discord.hasToken()) void window.api.discord.connect()
  },

  selectArtist: (id) =>
    set({ selectedArtistId: id, selectedAlbumId: null }),
  selectAlbum: (id) => set({ selectedAlbumId: id }),
  setSearch: (q) => set({ search: q }),
  setEditSong: (songId) => set({ editSongId: songId }),

  setKindTab: (kind) => {
    set({ kindTab: kind })
    persistJson('qs.kindTab', kind)
  },
  setGroupBy: (kind, dim) =>
    set((st) => {
      const groupBy = { ...st.groupBy, [kind]: dim }
      persistJson('qs.groupBy', groupBy)
      return { groupBy }
    }),
  setKindFilter: (kind, dim, value) =>
    set((st) => {
      const activeFilters = {
        ...st.activeFilters,
        [kind]: { ...st.activeFilters[kind], [dim]: value }
      }
      persistJson('qs.activeFilters', activeFilters)
      return { activeFilters }
    }),
  clearKindFilters: (kind) =>
    set((st) => {
      const activeFilters = { ...st.activeFilters, [kind]: {} }
      persistJson('qs.activeFilters', activeFilters)
      return { activeFilters }
    }),
  setBrowserSplit: (frac) => {
    const browserSplit = clampSplit(frac)
    persistJson('qs.browserSplit', browserSplit)
    set({ browserSplit })
  },
  setMixSplit: (frac) => {
    const mixSplit = clampSplit(frac)
    persistJson('qs.mixSplit', mixSplit)
    set({ mixSplit })
  },
  setRailWidth: (px) => {
    const railWidth = clampRail(px)
    persistJson('qs.railWidth', railWidth)
    set({ railWidth })
  },
  toggleArtistView: () => set((st) => ({ showArtistView: !st.showArtistView })),
  togglePlaylistsCollapsed: () =>
    set((st) => {
      const v = !st.playlistsCollapsed
      try {
        localStorage.setItem('qs.playlistsCollapsed', v ? '1' : '0')
      } catch {
        /* localStorage unavailable — preference just won't persist */
      }
      return { playlistsCollapsed: v }
    }),
  showNotice: (text, kind = 'info', persistent = false) => {
    // Blocking conditions become a sticky banner (its own slot, so a later transient
    // notice can't clobber it) and never auto-dismiss — best practice for errors the
    // user must act on.
    if (persistent) {
      set({ blockingAlert: text })
      return
    }
    const notice = { text, kind } as Notice
    const id = ++noticeSeq
    set({ notice })
    // Success/info can auto-dismiss quickly; errors linger longer so they aren't missed.
    const ms = kind === 'error' ? 8000 : 4500
    setTimeout(() => {
      if (noticeSeq === id) set({ notice: null })
    }, ms)
  },
  dismissNotice: () => set({ notice: null }),
  dismissAlert: () => set({ blockingAlert: null }),
  dismissBotError: () => set({ botErrorDismissed: get().bot.error ?? null }),
  dismissYtdlpSuggestion: () => set({ suggestYtdlpUpdate: false }),

  notePlaybackFailure: () => {
    const n = get().playbackFailures + 1
    set({ playbackFailures: n })
    // A stale yt-dlp is the usual cause of repeated YouTube failures — suggest an update.
    if (n >= 2) set({ suggestYtdlpUpdate: true })
  },

  updateYtdlp: async () => {
    if (get().updatingYtdlp) return
    set({ updatingYtdlp: true })
    const r = await window.api.tools.updateYtdlp()
    set({ updatingYtdlp: false })
    if (r.ok) {
      // Clear the conditions that prompted the update.
      set({ blockingAlert: null, suggestYtdlpUpdate: false, playbackFailures: 0 })
      get().showNotice(`yt-dlp updated${r.version ? ` to ${r.version}` : ''}.`, 'info')
    } else {
      get().showNotice(`yt-dlp update failed: ${r.error ?? 'unknown error'}`, 'error')
    }
  },

  // Install the AppImage launcher and surface the same success/error notice to both the
  // first-run prompt and Settings; callers handle their own extra state (dismiss / status).
  installDesktopMenu: async () => {
    const r = await window.api.desktop.install()
    if (r.ok) get().showNotice('Added QuestStream to your applications menu.', 'info')
    else get().showNotice(r.error ?? 'Could not add the menu entry', 'error')
    return r
  },

  enqueueSongs: (songs, atIndex) => {
    const items = songs.map((song) => ({ uid: newUid(), song }))
    set((st) => {
      const q = [...st.queue]
      const at = atIndex ?? q.length
      q.splice(at, 0, ...items)
      return { queue: q }
    })
    // If nothing is playing yet, warm up the top of the queue for an instant first play.
    const q = get().queue
    if (!get().currentUid && q[0]) void window.api.player.prefetch(q[0].song)
  },

  removeFromQueue: (uid) => {
    const isCurrent = get().currentUid === uid
    if (isCurrent) void window.api.player.stop() // stop the track we're actually playing
    set((st) => ({
      queue: st.queue.filter((q) => q.uid !== uid),
      selectedUid: st.selectedUid === uid ? null : st.selectedUid,
      currentUid: isCurrent ? null : st.currentUid
    }))
  },

  // Per-track loop: off → on (loop forever) → once (loop one more time) → off.
  cycleQueueLoop: (uid) =>
    set((st) => ({
      queue: st.queue.map((q) => {
        if (q.uid !== uid) return q
        const cur = q.loop ?? 'off'
        const next: LoopMode = cur === 'off' ? 'on' : cur === 'on' ? 'once' : 'off'
        return { ...q, loop: next }
      })
    })),

  selectQueueItem: (uid) => {
    set({ selectedUid: uid })
    // Warm up the selected track so hitting play is instant.
    const item = get().queue.find((q) => q.uid === uid)
    if (item && get().currentUid !== uid) void window.api.player.prefetch(item.song)
  },

  reorderQueue: (from, to) =>
    set((st) => {
      const q = [...st.queue]
      const [moved] = q.splice(from, 1)
      q.splice(to, 0, moved)
      return { queue: q }
    }),

  clearQueue: () => {
    void window.api.player.stop()
    set({ queue: [], currentUid: null, selectedUid: null, loadedPlaylistId: null })
  },

  loadPlaylist: (playlistId) => {
    const { library } = get()
    const pl = library.playlists.find((p) => p.id === playlistId)
    if (!pl) return
    const byId = new Map(library.songs.map((s) => [s.id, s]))
    const items = pl.songIds
      .map((id) => byId.get(id))
      .filter((s): s is Song => !!s)
      .map((song) => ({ uid: newUid(), song }))
    set({
      queue: items,
      currentUid: null,
      selectedUid: items[0]?.uid ?? null,
      loadedPlaylistId: playlistId
    })
    if (items[0]) void window.api.player.prefetch(items[0].song) // instant first play
  },

  playUid: async (uid) => {
    const { queue } = get()
    const idx = queue.findIndex((q) => q.uid === uid)
    const item = queue[idx]
    if (!item) return
    set({ currentUid: uid })
    // Plays through the local monitor when not in a voice channel (jukebox), or to
    // Discord when joined — the main process routes it either way.
    try {
      await window.api.player.play(item.song)
    } catch (err) {
      get().notePlaybackFailure()
      get().showNotice(`Playback failed: ${(err as Error).message}`, 'error')
    }
    // Warm up the next track so the upcoming crossfade/advance is instant.
    const next = queue[idx + 1]
    if (next) void window.api.player.prefetch(next.song)
  },

  togglePlayUid: async (uid) => {
    const { currentUid, player } = get()
    const active = player.state === 'playing' || player.state === 'buffering'
    if (uid === currentUid && active) await window.api.player.pause()
    else if (uid === currentUid && player.state === 'paused') await window.api.player.resume()
    else await get().playUid(uid)
  },

  seekTo: async (seconds) => {
    await window.api.player.seek(seconds)
    // Seeking re-decodes the current track, which drops the warmed next-track input;
    // re-prefetch it so the upcoming advance/crossfade stays instant.
    const { queue, currentUid } = get()
    const idx = queue.findIndex((q) => q.uid === currentUid)
    const next = queue[idx + 1]
    if (next) void window.api.player.prefetch(next.song)
  },

  playNext: async (auto = false) => {
    const { queue, currentUid, shuffle, repeat, library, loadedSceneId } = get()
    if (queue.length === 0) return
    const idx = queue.findIndex((q) => q.uid === currentUid)
    const cur = idx >= 0 ? queue[idx] : undefined
    // The playing scene's end-of-list policy governs the tail; undefined = legacy
    // behavior (global repeat/shuffle), pinned by tests/queue-policy.test.ts.
    const endOfList = loadedSceneId
      ? library.scenes.find((s) => s.id === loadedSceneId)?.endOfList
      : undefined
    const decision = nextQueueIndex(
      {
        index: idx,
        length: queue.length,
        shuffle,
        repeat,
        trackLoop: cur?.loop ?? 'off',
        auto,
        endOfList
      },
      Math.random
    )
    if (decision.kind === 'stop') {
      set({ currentUid: null })
      return
    }
    if (decision.kind === 'replay') {
      if (!currentUid) return
      if (decision.consumeTrackLoop) {
        // Consume the one-shot loop; the next natural end advances normally.
        set((st) => ({
          queue: st.queue.map((q) => (q.uid === currentUid ? { ...q, loop: 'off' as LoopMode } : q))
        }))
      }
      await get().playUid(currentUid)
      return
    }
    const target = queue[decision.index]
    if (target) await get().playUid(target.uid)
  },

  playPrev: async () => {
    const { queue, currentUid } = get()
    const idx = queue.findIndex((q) => q.uid === currentUid)
    const prev = queue[idx - 1]
    if (prev) await get().playUid(prev.uid)
    else if (queue.length) await get().playUid(queue[0].uid)
  },

  togglePlay: async () => {
    const { player, queue, currentUid, selectedUid } = get()
    if (player.state === 'playing' || player.state === 'buffering') {
      await window.api.player.pause()
    } else if (player.state === 'paused') {
      await window.api.player.resume()
    } else {
      // idle → play the selected item, else the current, else the top of the queue
      const target = selectedUid ?? currentUid ?? queue[0]?.uid
      if (target) await get().playUid(target)
    }
  },

  toggleShuffle: () => set((st) => ({ shuffle: !st.shuffle })),
  cycleRepeat: () =>
    set((st) => ({
      repeat: st.repeat === 'off' ? 'all' : st.repeat === 'all' ? 'one' : 'off'
    })),

  addAmbience: (song) => {
    const slot: AmbienceSlot = {
      id: newSlotId(),
      song,
      volume: 0.5,
      playing: true,
      mode: 'loop',
      minSec: 20,
      maxSec: 60
    }
    set((st) => ({ ambience: [...st.ambience, slot] }))
    // Mixer always exists, so this plays locally (jukebox) or to Discord as appropriate.
    void window.api.ambience.play(slot.id, slot.song, slot.volume)
  },

  removeAmbience: (slotId) => {
    void window.api.ambience.stop(slotId)
    set((st) => ({ ambience: st.ambience.filter((a) => a.id !== slotId) }))
  },

  toggleAmbience: (slotId) => {
    const slot = get().ambience.find((a) => a.id === slotId)
    if (!slot) return
    const playing = !slot.playing
    const next = { ...slot, playing }
    set((st) => ({ ambience: st.ambience.map((a) => (a.id === slotId ? next : a)) }))
    // A random layer that was paused may have no scheduler running; restart it from
    // scratch on resume. Otherwise the in-place pause/resume is enough for both modes.
    if (next.mode === 'random' && playing) applyAmbience(next)
    else void window.api.ambience.setPaused(slotId, !playing)
  },

  setAmbienceVolume: (slotId, volume) => {
    set((st) => ({
      ambience: st.ambience.map((a) => (a.id === slotId ? { ...a, volume } : a))
    }))
    void window.api.ambience.setVolume(slotId, volume)
  },

  setAmbienceMode: (slotId, mode) => {
    const slot = get().ambience.find((a) => a.id === slotId)
    if (!slot) return
    const next = { ...slot, mode }
    set((st) => ({ ambience: st.ambience.map((a) => (a.id === slotId ? next : a)) }))
    applyAmbience(next)
  },

  setAmbienceInterval: (slotId, minSec, maxSec) => {
    const lo = Math.max(1, Math.min(minSec, maxSec))
    const hi = Math.max(lo, maxSec)
    const slot = get().ambience.find((a) => a.id === slotId)
    if (!slot) return
    const next = { ...slot, minSec: lo, maxSec: hi }
    set((st) => ({ ambience: st.ambience.map((a) => (a.id === slotId ? next : a)) }))
    if (next.mode === 'random' && next.playing) applyAmbience(next)
  },

  triggerSfx: (soundboardId) => {
    void window.api.soundboard.trigger(soundboardId)
  },

  setDuck: (on) => {
    set({ ducking: on })
    void window.api.player.duck(on)
  },

  setMusicVolume: (volume) => {
    set({ musicVolume: volume })
    void window.api.player.setMusicVolume(volume)
  },

  setMasterVolume: (volume) => {
    // The Discord SEND level only (what remote players hear). The local monitor has its own
    // independent level via setMonitorVolume — the two are no longer coupled.
    // Optimistic: update the slider immediately instead of waiting for the playerStatus
    // round-trip (keeps the control consistent with every other store-driven action).
    set((st) => ({ player: { ...st.player, volume } }))
    void window.api.player.setVolume(volume)
  },

  setMonitorVolume: (volume) => {
    set({ monitorVolume: volume })
    localMonitor.setVolume(volume)
    try {
      localStorage.setItem('qs.monitorVolume', String(volume))
    } catch {
      /* localStorage unavailable — preference just won't persist */
    }
  },

  setTagColor: (tag, value) => {
    const next = { ...get().tagColors, [normalizeTag(tag)]: value }
    set({ tagColors: next })
    persistTagColors(next)
  },

  resetTagColor: (tag) => {
    const next = { ...get().tagColors }
    delete next[normalizeTag(tag)]
    set({ tagColors: next })
    persistTagColors(next)
  },

  refreshThemeSwatches: () => set({ themeSwatches: readThemeSwatches() }),

  setTheme: (name) => {
    persistJson('qs.theme', name)
    // Apply the attribute + re-read the --tag-* palette so tags recolour with the theme.
    const apply = (id: string): void => {
      applyThemeAttr(id)
      set({ theme: id, themeSwatches: readThemeSwatches() })
    }
    if (isBuiltinTheme(name)) {
      setUserThemeCss('') // drop any previously-injected user theme
      apply(name)
      return
    }
    // A user theme: fetch + inject its CSS, then apply. On failure (e.g. file deleted) fall back
    // to the default so a missing theme can never leave the UI unstyled.
    window.api.themes
      .read(name)
      .then((css) => {
        setUserThemeCss(css)
        apply(name)
      })
      .catch(() => {
        setUserThemeCss('')
        apply(DEFAULT_THEME)
      })
  },

  reloadThemes: () => {
    window.api.themes
      .list()
      .then((userThemes) => set({ userThemes }))
      .catch(() => set({ userThemes: [] }))
  },

  revealThemesFolder: () => void window.api.themes.reveal(),

  setOutputDevice: (deviceId) => {
    set({ outputDeviceId: deviceId })
    void localMonitor.setSinkId(deviceId)
    try {
      localStorage.setItem('qs.outputDeviceId', deviceId)
    } catch {
      /* localStorage unavailable — preference just won't persist */
    }
  },

  setMonitor: (on) => {
    if (get().monitorEnabled === on) return
    set({ monitorEnabled: on })
    if (on) {
      // Apply the saved monitor level + output device BEFORE start so the GainNode and sink
      // come up correct (the monitor restarts on every Discord join/leave).
      localMonitor.setVolume(get().monitorVolume)
      void localMonitor.setSinkId(get().outputDeviceId)
      void localMonitor.start()
    } else localMonitor.stop()
    void window.api.monitor.enable(on)
  },

  toggleMonitor: () => get().setMonitor(!get().monitorEnabled),

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  // Open Settings, optionally jumping to a specific tab (the top-bar Remote button passes 'remote').
  // With no arg it just opens, preserving whatever tab was last shown.
  openSettings: (tab) => set(tab ? { settingsOpen: true, settingsTab: tab } : { settingsOpen: true }),
  setUiScale: (scale) => {
    const uiScale = clampScale(scale)
    persistJson('qs.uiScale', uiScale)
    window.api.app.setZoomFactor(uiScale)
    set({ uiScale })
  },
  setTextScale: (scale) => {
    const textScale = clampScale(scale)
    persistJson('qs.textScale', textScale)
    applyTextScale(textScale)
    set({ textScale })
  },
  setSavePromptOpen: (open) => set({ savePromptOpen: open }),
  setSaveScenePromptOpen: (open) => set({ saveScenePromptOpen: open }),

  saveScene: async (name, id) => {
    const { queue, currentUid, musicVolume, ambience } = get()
    const currentIndex = Math.max(0, queue.findIndex((q) => q.uid === currentUid))
    const scene = await window.api.scenes.save({
      id,
      name: name.trim() || 'Untitled Scene',
      songIds: queue.map((q) => q.song.id),
      musicVolume,
      currentIndex,
      // One sound per layer now — persist a single-song pool (kept for back-compat with
      // scenes/packs that still read `pool`).
      ambience: ambience.map((a) => ({
        songId: a.song.id,
        volume: a.volume,
        playing: a.playing,
        mode: a.mode,
        pool: [a.song.id],
        minIntervalSec: a.minSec,
        maxIntervalSec: a.maxSec
      }))
    })
    set({ loadedSceneId: scene.id })
  },

  // F-key one-press recall = a full scene play.
  recallScene: (sceneId) => get().playScene(sceneId),

  playScene: (sceneId, opts = {}) => {
    const { library } = get()
    const scene = library.scenes.find((s) => s.id === sceneId)
    if (!scene) return
    const songsById = Object.fromEntries(library.songs.map((s) => [s.id, s]))
    const plan = buildRecallPlan(scene, songsById, opts)
    // Crossfade FIRST so the transition INTO this scene already uses its length;
    // a legacy scene (null sentinel) resets to the app default.
    void window.api.player.setCrossfadeMs(plan.crossfadeMs ?? DEFAULT_CROSSFADE_MS)
    get().applyRecallPlan(sceneId, plan)
    void window.api.scenes.markPlayed(sceneId)
  },

  // Apply a pure RecallPlan to the live mix (the one seam through which scenes
  // reach the player — full recall via recallScene, partial via the scene page).
  applyRecallPlan: (sceneId, plan) => {
    // Swap ambience: stop the current layers, build the plan's (a null plan side
    // leaves that side of the live mix completely untouched).
    let ambSlots: AmbienceSlot[] | null = null
    if (plan.ambience) {
      for (const slot of get().ambience) void window.api.ambience.stop(slot.id)
      ambSlots = plan.ambience.map((l) => ({
        id: newSlotId(),
        song: l.song,
        volume: l.volume,
        playing: l.playing,
        mode: l.mode,
        minSec: l.minSec,
        maxSec: l.maxSec
      }))
    }
    const items = plan.music ? plan.music.songs.map((song) => ({ uid: newUid(), song })) : null

    set({
      loadedSceneId: sceneId,
      ...(items
        ? { queue: items, currentUid: null, selectedUid: null, loadedPlaylistId: null }
        : {}),
      ...(ambSlots ? { ambience: ambSlots } : {}),
      ...(plan.music ? { musicVolume: plan.music.musicVolume } : {})
    })

    // Apply to the engine (crossfades from whatever was playing)
    if (plan.music) void window.api.player.setMusicVolume(plan.music.musicVolume)
    if (ambSlots) for (const slot of ambSlots) applyAmbience(slot)
    if (items && plan.music) {
      const start = items[plan.music.startIndex] ?? items[0]
      if (start) void get().playUid(start.uid)
    }
  },

  refreshGuilds: async () => {
    const guilds = await window.api.discord.getGuilds()
    set({ guilds })
    const sel = get().selectedGuildId
    if (!sel && guilds[0]) await get().selectGuild(guilds[0].id)
    else if (sel) await get().selectGuild(sel)
  },

  selectGuild: async (id) => {
    set({ selectedGuildId: id })
    const channels = await window.api.discord.getVoiceChannels(id)
    set({ channels, selectedChannelId: channels[0]?.id ?? null })
  },

  selectChannel: (id) => set({ selectedChannelId: id })
}))

export const fmtTime = (sec: number): string => {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
