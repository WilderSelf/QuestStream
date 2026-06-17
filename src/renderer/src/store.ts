import { create } from 'zustand'
import { localMonitor } from './monitor'
import type {
  LibrarySnapshot,
  Song,
  BotStatus,
  PlayerStatus,
  GuildInfo,
  VoiceChannelInfo,
  ImportProgress,
  AmbienceMode,
  RemoteCommand,
  RemoteState
} from '@shared/types'

export interface QueueItem {
  uid: string
  song: Song
}

export type RepeatMode = 'off' | 'all' | 'one'
export interface Notice {
  text: string
  kind: 'info' | 'error'
}
export interface AmbienceSlot {
  id: string
  song: Song // representative track (first of the pool)
  volume: number
  playing: boolean
  mode: AmbienceMode // 'loop' (default) or 'random' one-shots
  pool: Song[] // tracks that can fire in 'random' mode (includes `song`)
  minSec: number
  maxSec: number
}

let uidSeq = 0
const newUid = (): string => `q${Date.now()}_${uidSeq++}`
let initialized = false // guard against React StrictMode double-invoking init() (double IPC subs)
let noticeSeq = 0
let slotSeq = 0
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
    case 'setVolume': s.setMasterVolume(c.volume); break
    case 'duck': s.setDuck(c.on); break
    case 'recallScene': s.recallScene(c.id); break
    case 'triggerSfx': s.triggerSfx(c.id); break
    case 'playQueueItem': void s.playUid(c.uid); break
  }
}

/** Push an ambience slot's current mode/pool/volume to the audio engine. */
function applyAmbience(slot: AmbienceSlot): void {
  if (!slot.playing) {
    void window.api.ambience.stop(slot.id)
    return
  }
  if (slot.mode === 'random') {
    void window.api.ambience.playRandom(slot.id, slot.pool, slot.volume, slot.minSec, slot.maxSec)
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
  settingsOpen: boolean
  savePromptOpen: boolean
  saveScenePromptOpen: boolean
  loadedSceneId: string | null

  search: string
  selectedTag: string | null
  editSongId: string | null
  shuffle: boolean
  repeat: RepeatMode

  ambience: AmbienceSlot[]
  musicVolume: number
  monitorEnabled: boolean
  ducking: boolean
  remoteActive: boolean // is the LAN remote enabled (gates state pushes)

  // actions
  init: () => Promise<void>
  setRemoteActive: (on: boolean) => void
  selectArtist: (id: string) => void
  selectAlbum: (id: string) => void
  setSearch: (q: string) => void
  setSelectedTag: (tag: string | null) => void
  setEditSong: (songId: string | null) => void
  showNotice: (text: string, kind?: Notice['kind']) => void

  addAmbience: (song: Song) => void
  removeAmbience: (slotId: string) => void
  toggleAmbience: (slotId: string) => void
  setAmbienceVolume: (slotId: string, volume: number) => void
  setAmbienceMode: (slotId: string, mode: AmbienceMode) => void
  addAmbiencePoolSong: (slotId: string, song: Song) => void
  setAmbienceInterval: (slotId: string, minSec: number, maxSec: number) => void
  triggerSfx: (soundboardId: string) => void
  setDuck: (on: boolean) => void
  setMusicVolume: (volume: number) => void
  setMasterVolume: (volume: number) => void
  setMonitor: (on: boolean) => void
  toggleMonitor: () => void

  enqueueSongs: (songs: Song[], atIndex?: number) => void
  removeFromQueue: (uid: string) => void
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
  setSavePromptOpen: (open: boolean) => void
  setSaveScenePromptOpen: (open: boolean) => void
  saveScene: (name: string, id?: string) => Promise<void>
  recallScene: (sceneId: string) => void
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
  volume: 0.8
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
  settingsOpen: false,
  savePromptOpen: false,
  saveScenePromptOpen: false,
  loadedSceneId: null,
  search: '',
  selectedTag: null,
  editSongId: null,
  shuffle: false,
  repeat: 'off',
  ambience: [],
  musicVolume: 1,
  monitorEnabled: false,
  ducking: false,
  remoteActive: false,

  setRemoteActive: (on) => set({ remoteActive: on }),

  init: async () => {
    if (initialized) return // run once even under StrictMode's double-mount
    initialized = true
    const library = await window.api.library.get()
    set({ library })

    window.api.library.onChanged((snap) => set({ library: snap }))
    window.api.library.onImportProgress((p) => {
      set({ importStatus: p })
      if (p.status === 'done' || p.status === 'error') {
        setTimeout(() => {
          if (get().importStatus === p) set({ importStatus: null })
        }, 4000)
      }
    })
    window.api.discord.onStatus((s) => {
      const prev = get().bot
      set({ bot: s })
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
    window.api.player.onStatus((s) => set({ player: s }))
    window.api.player.onEnded(() => void get().playNext(true))
    window.api.monitor.onPcm((pcm) => {
      if (get().monitorEnabled) localMonitor.feed(pcm)
    })
    window.api.app.onNotice((n) => get().showNotice(n.message, n.kind))

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

    // Global soundboard hotkeys. Ignored while typing in a field or rebinding a key
    // (the bind UI sets a flag on window). A bound key fires its one-shot over the mix.
    window.addEventListener('keydown', (e) => {
      if ((window as unknown as { __sbBinding?: boolean }).__sbBinding) return
      const el = document.activeElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const hit = get().library.soundboard.find((sb) => sb.hotkey && sb.hotkey === e.key)
      if (hit) {
        e.preventDefault()
        get().triggerSfx(hit.id)
      }
    })

    // Not in a voice channel yet → behave like a local jukebox (monitor on).
    get().setMonitor(true)

    // auto-connect if a token already exists
    if (await window.api.discord.hasToken()) void window.api.discord.connect()
  },

  selectArtist: (id) =>
    set({ selectedArtistId: id, selectedAlbumId: null }),
  selectAlbum: (id) => set({ selectedAlbumId: id }),
  setSearch: (q) => set({ search: q }),
  setSelectedTag: (tag) => set({ selectedTag: tag }),
  setEditSong: (songId) => set({ editSongId: songId }),

  showNotice: (text, kind = 'info') => {
    const notice = { text, kind } as Notice
    const id = ++noticeSeq
    set({ notice })
    setTimeout(() => {
      if (noticeSeq === id) set({ notice: null })
    }, 4500)
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
    const { queue, currentUid, shuffle, repeat } = get()
    if (queue.length === 0) return

    // Repeat-one only auto-repeats when a track finishes on its own.
    if (auto && repeat === 'one' && currentUid) {
      await get().playUid(currentUid)
      return
    }

    if (shuffle) {
      const candidates = queue.filter((q) => q.uid !== currentUid)
      const pool = candidates.length ? candidates : queue
      const pick = pool[Math.floor(Math.random() * pool.length)]
      await get().playUid(pick.uid)
      return
    }

    const idx = queue.findIndex((q) => q.uid === currentUid)
    const next = queue[idx + 1]
    if (next) await get().playUid(next.uid)
    else if (repeat === 'all') await get().playUid(queue[0].uid)
    else set({ currentUid: null })
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
      pool: [song],
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

  addAmbiencePoolSong: (slotId, song) => {
    const slot = get().ambience.find((a) => a.id === slotId)
    if (!slot || slot.pool.some((s) => s.id === song.id)) return
    const next = { ...slot, pool: [...slot.pool, song] }
    set((st) => ({ ambience: st.ambience.map((a) => (a.id === slotId ? next : a)) }))
    if (next.mode === 'random' && next.playing) applyAmbience(next)
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
    // Optimistic: update the slider immediately instead of waiting for the playerStatus
    // round-trip (keeps the control consistent with every other store-driven action).
    set((st) => ({ player: { ...st.player, volume } }))
    localMonitor.setVolume(volume) // local jukebox path (the bot resource handles Discord)
    void window.api.player.setVolume(volume)
  },

  setMonitor: (on) => {
    if (get().monitorEnabled === on) return
    set({ monitorEnabled: on })
    if (on) void localMonitor.start()
    else localMonitor.stop()
    void window.api.monitor.enable(on)
  },

  toggleMonitor: () => get().setMonitor(!get().monitorEnabled),

  setSettingsOpen: (open) => set({ settingsOpen: open }),
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
      ambience: ambience.map((a) => ({
        songId: a.song.id,
        volume: a.volume,
        playing: a.playing,
        mode: a.mode,
        pool: a.pool.map((s) => s.id),
        minIntervalSec: a.minSec,
        maxIntervalSec: a.maxSec
      }))
    })
    set({ loadedSceneId: scene.id })
  },

  recallScene: (sceneId) => {
    const { library } = get()
    const scene = library.scenes.find((s) => s.id === sceneId)
    if (!scene) return
    const byId = new Map(library.songs.map((s) => [s.id, s]))

    // Music queue
    const items = scene.songIds
      .map((sid) => byId.get(sid))
      .filter((s): s is Song => !!s)
      .map((song) => ({ uid: newUid(), song }))

    // Swap ambience: stop the current layers, build the scene's
    for (const slot of get().ambience) void window.api.ambience.stop(slot.id)
    const ambSlots: AmbienceSlot[] = scene.ambience
      .map((a) => {
        const song = byId.get(a.songId)
        if (!song) return null
        const pool = (a.pool ?? [a.songId]).map((id) => byId.get(id)).filter((s): s is Song => !!s)
        return {
          id: newSlotId(),
          song,
          volume: a.volume,
          playing: a.playing,
          mode: a.mode ?? 'loop',
          pool: pool.length ? pool : [song],
          minSec: a.minIntervalSec ?? 20,
          maxSec: a.maxIntervalSec ?? 60
        }
      })
      .filter((s): s is AmbienceSlot => !!s)

    set({
      queue: items,
      currentUid: null,
      selectedUid: null,
      loadedPlaylistId: null,
      loadedSceneId: sceneId,
      ambience: ambSlots,
      musicVolume: scene.musicVolume
    })

    // Apply to the engine (crossfades from whatever was playing)
    void window.api.player.setMusicVolume(scene.musicVolume)
    for (const slot of ambSlots) applyAmbience(slot)
    const start = items[scene.currentIndex] ?? items[0]
    if (start) void get().playUid(start.uid)
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
