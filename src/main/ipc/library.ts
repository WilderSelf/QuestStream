import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { IPC, type SceneInput, type ImportOpts } from '../../shared/ipc'
import type {
  RetagPayload,
  Song,
  ImportProgress,
  SoundboardItem,
  CookiesMode,
  CookieBrowser,
  CookiesStatus
} from '../../shared/types'
import { copyIntoMedia, removeMedia, AUDIO_EXTS } from '../library/media'
import { buildScenePack, buildPlaylistPack, validatePack, importPack } from '../library/packs'
import { probe, extractTrack, type ResolvedTrack } from '../bot/ytdlp'
import { toolStatus, setCookieArgs } from '../bot/binaries'
import { updateYtDlp } from '../bot/updater'
import { buildCookieArgs, cookiesFilePath, isCookieBrowser } from '../bot/cookies'
import { desktopStatus, installDesktopEntry } from '../desktop'
import { checkForUpdates, quitAndInstall } from '../appUpdater'
import { join } from 'node:path'
import type { IpcContext } from './context'

const MAX_PACK_BYTES = 8 * 1024 * 1024 // a metadata-only pack is KBs; reject anything absurd

/** Run an IPC op, turning a thrown error into the uniform { ok:false, error } result. */
async function guarded<T extends { ok: boolean }>(
  fn: () => Promise<T>
): Promise<T | { ok: false; error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Library + content IPC: import (URL & local files), tagging, soundboard, playlists,
 * scenes, and shareable packs. All of these mutate the store and re-broadcast it.
 */
export function registerLibraryIpc(ctx: IpcContext): void {
  const { store, bot, config, mediaDir, userData, handle, send, broadcastLibrary, openDialog, saveDialog } = ctx
  const sendProgress = (p: ImportProgress): void => send(IPC.importProgress, p)

  // Serialize imports so their progress toasts can't interleave into garbage totals,
  // while each caller still receives its own result.
  let importChain: Promise<unknown> = Promise.resolve()
  const queueImport = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = importChain.then(fn)
    importChain = run.catch(() => undefined) // a failed import must not break the chain
    return run
  }

  // ---- library ----
  handle(IPC.libraryGet, () => store.view())

  // ---- external tools (yt-dlp updater) ----
  handle(IPC.toolsGetStatus, () => toolStatus())
  handle(IPC.toolsUpdateYtdlp, () => updateYtDlp(join(userData, 'bin')))

  // ---- YouTube cookies (bypass the "confirm you're not a bot" wall) ----
  const cookieStatus = (): CookiesStatus => ({
    mode: config.cookiesMode,
    browser: isCookieBrowser(config.cookiesBrowser) ? config.cookiesBrowser : undefined,
    hasFile: existsSync(cookiesFilePath(userData))
  })
  // Rebuild the yt-dlp cookie args from the current setting (called after any change).
  const applyCookies = (): void =>
    setCookieArgs(
      buildCookieArgs({ mode: config.cookiesMode, browser: config.cookiesBrowser, userData })
    )

  handle(IPC.cookiesGet, () => cookieStatus())
  handle(IPC.cookiesSetMode, (_e, mode: CookiesMode, browser?: CookieBrowser) => {
    const b = mode === 'browser' && browser && isCookieBrowser(browser) ? browser : ''
    // 'browser' with no valid browser falls back to off, so we never emit a bad flag.
    config.setCookies(mode === 'browser' && !b ? 'none' : mode, b)
    applyCookies()
    return cookieStatus()
  })
  handle(IPC.cookiesImportFile, async (): Promise<{ ok: boolean; error?: string; status?: CookiesStatus }> => {
    const res = await openDialog({
      title: 'Choose a cookies.txt file',
      properties: ['openFile'],
      filters: [{ name: 'Cookies (Netscape txt)', extensions: ['txt'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: true } // cancelled — no change
    return guarded(async () => {
      const src = res.filePaths[0]
      const content = readFileSync(src, 'utf8')
      // A Netscape cookies file has the header and/or data lines of 7 tab-separated fields.
      // Requiring real structure (not merely "contains a tab") avoids copying arbitrary text
      // that yt-dlp would then silently ignore — a confusing failure to debug.
      const hasHeader = /# (Netscape|HTTP Cookie File)/i.test(content)
      const hasCookieLine = content
        .split('\n')
        .some((l) => l.trim() && !l.startsWith('#') && l.split('\t').length === 7)
      if (!hasHeader && !hasCookieLine) {
        return { ok: false, error: 'That doesn’t look like a cookies.txt (Netscape format) file.' }
      }
      copyFileSync(src, cookiesFilePath(userData))
      config.setCookies('file')
      applyCookies()
      return { ok: true, status: cookieStatus() }
    })
  })

  // ---- desktop integration (AppImage → applications menu) ----
  handle(IPC.desktopGetStatus, () => desktopStatus())
  handle(IPC.desktopInstall, () => {
    const r = installDesktopEntry()
    return { ...r, status: desktopStatus() }
  })

  // ---- auto-update (electron-updater) ----
  handle(IPC.updateCheck, () => checkForUpdates())
  handle(IPC.updateInstall, () => quitAndInstall())

  const doImport = async (
    url: string,
    opts?: ImportOpts
  ): Promise<{ ok: boolean; error?: string }> => {
    const clean = (url ?? '').trim()
    if (!clean) return { ok: false, error: 'Empty URL' }
    if (!/^https?:\/\//i.test(clean)) return { ok: false, error: 'Enter an http(s) URL' }
    try {
      sendProgress({ url: clean, status: 'resolving' })
      const result = await probe(clean)
      const addedSongIds: string[] = []
      const stamp = (track: ResolvedTrack): void => {
        if (!track.videoId) return
        // Only newly-created songs go in addedSongIds — a re-imported URL is de-duped by
        // the store, and the import wizard would otherwise re-tag it (clobbering its tags).
        const isNew = !store.hasSong(track.videoId)
        const song = store.addSong({ ...track, kind: opts?.kind, tags: opts?.tags })
        if (isNew) addedSongIds.push(song.id)
      }

      // Single video: the probe already resolved it fully — no second network call.
      if (result.kind === 'video' && result.track) {
        stamp(result.track)
        broadcastLibrary()
        sendProgress({ url: clean, status: 'done', total: 1, completed: 1, addedSongIds })
        return { ok: true }
      }

      // Playlist: resolve each entry (this is where the per-entry network cost lives).
      const total = result.entryUrls.length
      let completed = 0
      for (const entry of result.entryUrls) {
        try {
          stamp(await extractTrack(entry, result.playlistTitle))
        } catch (err) {
          console.error('[import] failed for', entry, (err as Error).message)
        }
        completed++
        sendProgress({ url: clean, status: 'importing', total, completed })
        if (addedSongIds.length && completed % 5 === 0) broadcastLibrary()
      }
      broadcastLibrary()
      sendProgress({ url: clean, status: 'done', total, completed, addedSongIds })
      return { ok: true }
    } catch (err) {
      const message = (err as Error).message
      sendProgress({ url: clean, status: 'error', message })
      return { ok: false, error: message }
    }
  }
  handle(IPC.libraryAddUrl, (_e, url: string, opts?: ImportOpts) =>
    queueImport(() => doImport(url, opts))
  )

  // Import local files. The dialog routes through the XDG Document portal under Flatpak,
  // so only the picked files are granted; we copy each into the media dir immediately.
  handle(IPC.libraryAddFiles, async (_e, opts?: ImportOpts): Promise<{ ok: boolean; added: number; error?: string }> => {
    const result = await openDialog({
      title: 'Add local audio files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTS }]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: true, added: 0 }
    return queueImport(async () => {
      let added = 0
      const total = result.filePaths.length
      const addedSongIds: string[] = []
      sendProgress({ url: 'Local files', status: 'importing', total, completed: 0 })
      for (const [i, path] of result.filePaths.entries()) {
        try {
          const m = await copyIntoMedia(mediaDir, path)
          const isNew = !store.hasSong(`local:${m.sha1}`)
          const song = store.addSong({
            videoId: `local:${m.sha1}`,
            url: m.storedPath,
            title: m.title,
            artistName: m.artist ?? 'Unknown Artist',
            albumTitle: m.album ?? 'Local Files',
            duration: m.durationSec,
            sourceType: 'local',
            kind: opts?.kind,
            tags: opts?.tags
          })
          if (isNew) addedSongIds.push(song.id) // only new songs get tagged by the wizard
          added++
        } catch (err) {
          console.error('[import] local file failed for', path, (err as Error).message)
        }
        sendProgress({ url: 'Local files', status: 'importing', total, completed: i + 1 })
      }
      broadcastLibrary()
      sendProgress({ url: 'Local files', status: 'done', total, completed: total, addedSongIds })
      return { ok: true, added }
    })
  })

  handle(IPC.librarySetEffect, (_e, songId: string, effect: string | null) => {
    store.setEffect(songId, effect)
    broadcastLibrary()
  })
  handle(IPC.libraryRetag, (_e, songId: string, payload: RetagPayload) => {
    store.retag(songId, payload)
    broadcastLibrary()
  })
  handle(IPC.libraryDeleteSong, (_e, songId: string) => {
    const song = store.getSong(songId)
    store.deleteSong(songId)
    // Content-addressed media is 1:1 with its song, so deleting it orphans the file.
    if (song?.sourceType === 'local') removeMedia(mediaDir, song.url)
    broadcastLibrary()
  })

  // ---- soundboard ----
  handle(IPC.soundboardAdd, (_e, songId: string) => {
    const item = store.addSoundboardItem(songId)
    broadcastLibrary()
    return item
  })
  handle(IPC.soundboardUpdate, (_e, id: string, patch: Partial<SoundboardItem>) => {
    store.updateSoundboardItem(id, patch)
    broadcastLibrary()
  })
  handle(IPC.soundboardRemove, (_e, id: string) => {
    store.removeSoundboardItem(id)
    broadcastLibrary()
  })
  handle(IPC.soundboardTrigger, (_e, id: string) => {
    const item = store.getSoundboardItem(id)
    if (!item) return
    const song = store.getSong(item.songId)
    if (song) bot.playOneShot(song, item.gain ?? 1, item.duckUnderMusic ?? false)
  })

  // ---- playlists & scenes ----
  handle(IPC.playlistSave, (_e, name: string, songIds: string[], id?: string) => {
    const pl = store.savePlaylist(name, songIds, id)
    broadcastLibrary()
    return pl
  })
  handle(IPC.playlistDelete, (_e, id: string) => {
    store.deletePlaylist(id)
    broadcastLibrary()
  })
  handle(IPC.sceneSave, (_e, scene: SceneInput) => {
    const saved = store.saveScene(scene)
    broadcastLibrary()
    return saved
  })
  handle(IPC.sceneDelete, (_e, id: string) => {
    store.deleteScene(id)
    broadcastLibrary()
  })

  // ---- shareable packs (metadata-only .questpack JSON) ----
  const exportPack = async (
    pack: object | null,
    suggested: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!pack) return { ok: false, error: 'Nothing to export' }
    const res = await saveDialog({
      title: 'Export pack',
      defaultPath: `${suggested.replace(/[^\w.-]+/g, '_')}.questpack`,
      filters: [{ name: 'QuestStream pack', extensions: ['questpack', 'json'] }]
    })
    const { filePath } = res
    if (res.canceled || !filePath) return { ok: true }
    return guarded(async () => {
      writeFileSync(filePath, JSON.stringify(pack, null, 2), 'utf8')
      return { ok: true }
    })
  }
  handle(IPC.sceneExport, (_e, id: string) =>
    exportPack(buildScenePack(store.view(), id), store.view().scenes.find((s) => s.id === id)?.name ?? 'scene')
  )
  handle(IPC.playlistExport, (_e, id: string) =>
    exportPack(buildPlaylistPack(store.view(), id), store.view().playlists.find((p) => p.id === id)?.name ?? 'playlist')
  )
  handle(IPC.packImport, async (): Promise<{ ok: boolean; kind?: 'scene' | 'playlist'; name?: string; error?: string }> => {
    const res = await openDialog({
      title: 'Import a pack',
      properties: ['openFile'],
      filters: [{ name: 'QuestStream pack', extensions: ['questpack', 'json'] }]
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: true }
    return guarded(async () => {
      const file = res.filePaths[0]
      if (statSync(file).size > MAX_PACK_BYTES) return { ok: false, error: 'That file is too large to be a pack.' }
      const pack = validatePack(JSON.parse(readFileSync(file, 'utf8')))
      const created = importPack(store, pack)
      broadcastLibrary()
      return { ok: true, kind: created.kind, name: created.name }
    })
  })
}
