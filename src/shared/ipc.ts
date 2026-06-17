// Channel names + the typed surface exposed on window.api by the preload script.
import type {
  LibrarySnapshot,
  ImportProgress,
  Playlist,
  Scene,
  SoundboardItem,
  RetagPayload,
  GuildInfo,
  VoiceChannelInfo,
  BotStatus,
  PlayerStatus,
  Song,
  AppNotice,
  RemoteCommand,
  RemoteState,
  RemoteInfo
} from './types'

export type SceneInput = Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

export const IPC = {
  // library
  libraryGet: 'library:get',
  libraryAddUrl: 'library:addUrl',
  libraryAddFiles: 'library:addFiles', // opens a file picker, imports local audio
  librarySetEffect: 'library:setEffect', // set a song's DSP effect preset
  libraryRetag: 'library:retag',
  libraryDeleteSong: 'library:deleteSong',
  libraryChanged: 'library:changed', // main -> renderer event
  importProgress: 'library:importProgress', // main -> renderer event

  // soundboard
  soundboardAdd: 'soundboard:add',
  soundboardUpdate: 'soundboard:update',
  soundboardRemove: 'soundboard:remove',
  soundboardTrigger: 'soundboard:trigger',

  // playlists
  playlistSave: 'playlist:save',
  playlistDelete: 'playlist:delete',
  playlistExport: 'playlist:export',

  // scenes
  sceneSave: 'scene:save',
  sceneDelete: 'scene:delete',
  sceneExport: 'scene:export',

  // shareable packs (import auto-detects scene vs playlist)
  packImport: 'pack:import',

  // discord
  discordHasToken: 'discord:hasToken',
  discordSetToken: 'discord:setToken',
  discordConnect: 'discord:connect',
  discordDisconnect: 'discord:disconnect',
  discordGetGuilds: 'discord:getGuilds',
  discordGetVoiceChannels: 'discord:getVoiceChannels',
  discordJoin: 'discord:join',
  discordLeave: 'discord:leave',
  discordStatus: 'discord:status', // main -> renderer event

  // player
  playerPlay: 'player:play',
  playerPrefetch: 'player:prefetch',
  playerPause: 'player:pause',
  playerResume: 'player:resume',
  playerStop: 'player:stop',
  playerSeek: 'player:seek',
  playerSetVolume: 'player:setVolume',
  playerSetMusicVolume: 'player:setMusicVolume',
  playerDuck: 'player:duck', // manual narration duck
  playerStatus: 'player:status', // main -> renderer event
  playerEnded: 'player:ended', // main -> renderer event (current track finished)

  // ambience layers
  ambiencePlay: 'ambience:play',
  ambiencePlayRandom: 'ambience:playRandom',
  ambienceStop: 'ambience:stop',
  ambienceSetVolume: 'ambience:setVolume',
  ambienceSetPaused: 'ambience:setPaused',

  // local monitoring
  monitorEnable: 'monitor:enable',
  monitorPcm: 'monitor:pcm', // main -> renderer event (mixed PCM)

  // remote control (LAN web remote / Stream Deck)
  remoteCommand: 'remote:command', // main -> renderer event (a command to execute)
  remotePushState: 'remote:pushState', // renderer -> main (send; snapshot for /api/state)
  remoteGetInfo: 'remote:getInfo',
  remoteSetEnabled: 'remote:setEnabled',
  remoteGetToken: 'remote:getToken', // reveal the raw token for Stream Deck / HTTP automation
  remoteResetToken: 'remote:resetToken', // rotate the token (unpairs all devices)

  // app-level notices
  notice: 'app:notice' // main -> renderer event (toast)
} as const

/** Channels the MAIN process pushes to the renderer (no main-side handler/listener). */
export const EVENT_CHANNELS: readonly string[] = [
  IPC.libraryChanged,
  IPC.importProgress,
  IPC.discordStatus,
  IPC.playerStatus,
  IPC.playerEnded,
  IPC.monitorPcm,
  IPC.remoteCommand,
  IPC.notice
]

/**
 * Channels the MAIN process must register a handler/listener for (renderer → main).
 * `registerIpc` asserts at startup that exactly these are wired — so decomposing the
 * IPC layer can't silently drop or duplicate a channel.
 */
export const MAIN_HANDLED_CHANNELS: readonly string[] = Object.values(IPC).filter(
  (c) => !EVENT_CHANNELS.includes(c)
)

// The shape bridged onto window.api in the renderer.
export interface RendererApi {
  library: {
    get(): Promise<LibrarySnapshot>
    addUrl(url: string): Promise<{ ok: boolean; error?: string }>
    addFiles(): Promise<{ ok: boolean; added: number; error?: string }>
    setEffect(songId: string, effect: string | null): Promise<void>
    retag(songId: string, payload: RetagPayload): Promise<void>
    deleteSong(songId: string): Promise<void>
    onChanged(cb: (snap: LibrarySnapshot) => void): () => void
    onImportProgress(cb: (p: ImportProgress) => void): () => void
  }
  soundboard: {
    add(songId: string): Promise<SoundboardItem>
    update(id: string, patch: Partial<Omit<SoundboardItem, 'id'>>): Promise<void>
    remove(id: string): Promise<void>
    trigger(id: string): Promise<void>
  }
  playlists: {
    save(name: string, songIds: string[], id?: string): Promise<Playlist>
    remove(id: string): Promise<void>
    export(id: string): Promise<{ ok: boolean; error?: string }>
  }
  scenes: {
    save(scene: SceneInput): Promise<Scene>
    remove(id: string): Promise<void>
    export(id: string): Promise<{ ok: boolean; error?: string }>
  }
  packs: {
    import(): Promise<{ ok: boolean; kind?: 'scene' | 'playlist'; name?: string; error?: string }>
  }
  discord: {
    hasToken(): Promise<boolean>
    setToken(token: string): Promise<void>
    connect(): Promise<BotStatus>
    disconnect(): Promise<void>
    getGuilds(): Promise<GuildInfo[]>
    getVoiceChannels(guildId: string): Promise<VoiceChannelInfo[]>
    join(guildId: string, channelId: string): Promise<void>
    leave(): Promise<void>
    onStatus(cb: (s: BotStatus) => void): () => void
  }
  player: {
    play(song: Song): Promise<void>
    prefetch(song: Song): Promise<void>
    pause(): Promise<void>
    resume(): Promise<void>
    stop(): Promise<void>
    seek(seconds: number): Promise<void>
    setVolume(volume: number): Promise<void>
    setMusicVolume(volume: number): Promise<void>
    duck(on: boolean): Promise<void>
    onStatus(cb: (s: PlayerStatus) => void): () => void
    onEnded(cb: (songId: string) => void): () => void
  }
  ambience: {
    play(slotId: string, song: Song, volume: number): Promise<void>
    playRandom(slotId: string, songs: Song[], volume: number, minSec: number, maxSec: number): Promise<void>
    stop(slotId: string): Promise<void>
    setVolume(slotId: string, volume: number): Promise<void>
    setPaused(slotId: string, paused: boolean): Promise<void>
  }
  monitor: {
    enable(on: boolean): Promise<void>
    onPcm(cb: (pcm: Uint8Array) => void): () => void
  }
  remote: {
    onCommand(cb: (cmd: RemoteCommand) => void): () => void
    pushState(state: RemoteState): void
    getInfo(): Promise<RemoteInfo>
    setEnabled(on: boolean): Promise<RemoteInfo>
    getToken(): Promise<string | null>
    resetToken(): Promise<RemoteInfo>
  }
  app: {
    onNotice(cb: (n: AppNotice) => void): () => void
  }
}
