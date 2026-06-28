import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi } from '../shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: RendererApi = {
  library: {
    get: () => ipcRenderer.invoke(IPC.libraryGet),
    addUrl: (url, opts) => ipcRenderer.invoke(IPC.libraryAddUrl, url, opts),
    addFiles: (opts) => ipcRenderer.invoke(IPC.libraryAddFiles, opts),
    setEffect: (songId, effect) => ipcRenderer.invoke(IPC.librarySetEffect, songId, effect),
    retag: (songId, payload) => ipcRenderer.invoke(IPC.libraryRetag, songId, payload),
    deleteSong: (songId) => ipcRenderer.invoke(IPC.libraryDeleteSong, songId),
    onChanged: (cb) => subscribe(IPC.libraryChanged, cb),
    onImportProgress: (cb) => subscribe(IPC.importProgress, cb)
  },
  soundboard: {
    add: (songId) => ipcRenderer.invoke(IPC.soundboardAdd, songId),
    update: (id, patch) => ipcRenderer.invoke(IPC.soundboardUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.soundboardRemove, id),
    trigger: (id) => ipcRenderer.invoke(IPC.soundboardTrigger, id)
  },
  playlists: {
    save: (name, songIds, id) => ipcRenderer.invoke(IPC.playlistSave, name, songIds, id),
    remove: (id) => ipcRenderer.invoke(IPC.playlistDelete, id),
    export: (id) => ipcRenderer.invoke(IPC.playlistExport, id)
  },
  scenes: {
    save: (scene) => ipcRenderer.invoke(IPC.sceneSave, scene),
    remove: (id) => ipcRenderer.invoke(IPC.sceneDelete, id),
    export: (id) => ipcRenderer.invoke(IPC.sceneExport, id)
  },
  packs: {
    import: () => ipcRenderer.invoke(IPC.packImport)
  },
  tools: {
    getStatus: () => ipcRenderer.invoke(IPC.toolsGetStatus),
    updateYtdlp: () => ipcRenderer.invoke(IPC.toolsUpdateYtdlp)
  },
  cookies: {
    get: () => ipcRenderer.invoke(IPC.cookiesGet),
    setMode: (mode, browser) => ipcRenderer.invoke(IPC.cookiesSetMode, mode, browser),
    importFile: () => ipcRenderer.invoke(IPC.cookiesImportFile)
  },
  desktop: {
    getStatus: () => ipcRenderer.invoke(IPC.desktopGetStatus),
    install: () => ipcRenderer.invoke(IPC.desktopInstall)
  },
  update: {
    onStatus: (cb) => subscribe(IPC.updateStatus, cb),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    check: () => ipcRenderer.invoke(IPC.updateCheck)
  },
  discord: {
    hasToken: () => ipcRenderer.invoke(IPC.discordHasToken),
    setToken: (token) => ipcRenderer.invoke(IPC.discordSetToken, token),
    connect: () => ipcRenderer.invoke(IPC.discordConnect),
    disconnect: () => ipcRenderer.invoke(IPC.discordDisconnect),
    getGuilds: () => ipcRenderer.invoke(IPC.discordGetGuilds),
    getVoiceChannels: (guildId) => ipcRenderer.invoke(IPC.discordGetVoiceChannels, guildId),
    join: (guildId, channelId) => ipcRenderer.invoke(IPC.discordJoin, guildId, channelId),
    leave: () => ipcRenderer.invoke(IPC.discordLeave),
    onStatus: (cb) => subscribe(IPC.discordStatus, cb)
  },
  player: {
    play: (song) => ipcRenderer.invoke(IPC.playerPlay, song),
    prefetch: (song) => ipcRenderer.invoke(IPC.playerPrefetch, song),
    pause: () => ipcRenderer.invoke(IPC.playerPause),
    resume: () => ipcRenderer.invoke(IPC.playerResume),
    stop: () => ipcRenderer.invoke(IPC.playerStop),
    seek: (seconds) => ipcRenderer.invoke(IPC.playerSeek, seconds),
    setVolume: (volume) => ipcRenderer.invoke(IPC.playerSetVolume, volume),
    setMusicVolume: (volume) => ipcRenderer.invoke(IPC.playerSetMusicVolume, volume),
    duck: (on) => ipcRenderer.invoke(IPC.playerDuck, on),
    onStatus: (cb) => subscribe(IPC.playerStatus, cb),
    onEnded: (cb) => subscribe(IPC.playerEnded, cb)
  },
  ambience: {
    play: (slotId, song, volume) => ipcRenderer.invoke(IPC.ambiencePlay, slotId, song, volume),
    playRandom: (slotId, songs, volume, minSec, maxSec) =>
      ipcRenderer.invoke(IPC.ambiencePlayRandom, slotId, songs, volume, minSec, maxSec),
    stop: (slotId) => ipcRenderer.invoke(IPC.ambienceStop, slotId),
    setVolume: (slotId, volume) => ipcRenderer.invoke(IPC.ambienceSetVolume, slotId, volume),
    setPaused: (slotId, paused) => ipcRenderer.invoke(IPC.ambienceSetPaused, slotId, paused),
    onStatus: (cb) => subscribe(IPC.ambienceStatus, cb)
  },
  monitor: {
    enable: (on) => ipcRenderer.invoke(IPC.monitorEnable, on),
    onPcm: (cb) => subscribe(IPC.monitorPcm, cb)
  },
  remote: {
    onCommand: (cb) => subscribe(IPC.remoteCommand, cb),
    pushState: (state) => ipcRenderer.send(IPC.remotePushState, state),
    getInfo: () => ipcRenderer.invoke(IPC.remoteGetInfo),
    setEnabled: (on) => ipcRenderer.invoke(IPC.remoteSetEnabled, on),
    getToken: () => ipcRenderer.invoke(IPC.remoteGetToken),
    resetToken: () => ipcRenderer.invoke(IPC.remoteResetToken)
  },
  app: {
    onNotice: (cb) => subscribe(IPC.notice, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
