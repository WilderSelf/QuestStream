import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { IPC, type SceneInput } from '../../shared/ipc'
import type { RetagPayload, Song, ImportProgress, SoundboardItem } from '../../shared/types'
import { Enricher } from '../library/enrich'
import { copyIntoMedia, removeMedia, AUDIO_EXTS } from '../library/media'
import { buildScenePack, buildPlaylistPack, validatePack, importPack } from '../library/packs'
import { probe, extractTrack } from '../bot/ytdlp'
import type { IpcContext } from './context'

const MAX_PACK_BYTES = 8 * 1024 * 1024 // a metadata-only pack is KBs; reject anything absurd

/**
 * Library + content IPC: import (URL & local files), tagging, soundboard, playlists,
 * scenes, and shareable packs. All of these mutate the store and re-broadcast it.
 */
export function registerLibraryIpc(ctx: IpcContext): { enricher: Enricher } {
  const { store, bot, mediaDir, appVersion, handle, send, broadcastLibrary, openDialog, saveDialog } = ctx
  const sendProgress = (p: ImportProgress): void => send(IPC.importProgress, p)

  const enricher = new Enricher(store, broadcastLibrary, appVersion)
  enricher.enqueue(store.unenrichedSongIds())

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

  const doImport = async (url: string): Promise<{ ok: boolean; error?: string }> => {
    const clean = (url ?? '').trim()
    if (!clean) return { ok: false, error: 'Empty URL' }
    if (!/^https?:\/\//i.test(clean)) return { ok: false, error: 'Enter an http(s) URL' }
    try {
      sendProgress({ url: clean, status: 'resolving' })
      const result = await probe(clean)
      const total = result.entryUrls.length
      let completed = 0
      const addedSongIds: string[] = []
      for (const entry of result.entryUrls) {
        try {
          const track = await extractTrack(entry, result.playlistTitle)
          if (track.videoId) addedSongIds.push(store.addSong(track).id)
        } catch (err) {
          console.error('[import] failed for', entry, (err as Error).message)
        }
        completed++
        sendProgress({ url: clean, status: 'importing', total, completed })
        if (addedSongIds.length && completed % 5 === 0) broadcastLibrary()
      }
      broadcastLibrary()
      sendProgress({ url: clean, status: 'done', total, completed, addedSongIds })
      enricher.enqueue(addedSongIds)
      return { ok: true }
    } catch (err) {
      const message = (err as Error).message
      sendProgress({ url: clean, status: 'error', message })
      return { ok: false, error: message }
    }
  }
  handle(IPC.libraryAddUrl, (_e, url: string) => queueImport(() => doImport(url)))

  // Import local files. The dialog routes through the XDG Document portal under Flatpak,
  // so only the picked files are granted; we copy each into the media dir immediately.
  handle(IPC.libraryAddFiles, async (): Promise<{ ok: boolean; added: number; error?: string }> => {
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
          const song = store.addSong({
            videoId: `local:${m.sha1}`,
            url: m.storedPath,
            title: m.title,
            artistName: m.artist ?? 'Unknown Artist',
            albumTitle: m.album ?? 'Local Files',
            duration: m.durationSec,
            sourceType: 'local'
          })
          addedSongIds.push(song.id)
          added++
        } catch (err) {
          console.error('[import] local file failed for', path, (err as Error).message)
        }
        sendProgress({ url: 'Local files', status: 'importing', total, completed: i + 1 })
      }
      broadcastLibrary()
      sendProgress({ url: 'Local files', status: 'done', total, completed: total, addedSongIds })
      enricher.enqueue(addedSongIds)
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
    if (res.canceled || !res.filePath) return { ok: true }
    try {
      writeFileSync(res.filePath, JSON.stringify(pack, null, 2), 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
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
    try {
      const file = res.filePaths[0]
      if (statSync(file).size > MAX_PACK_BYTES) return { ok: false, error: 'That file is too large to be a pack.' }
      const pack = validatePack(JSON.parse(readFileSync(file, 'utf8')))
      const created = importPack(store, pack)
      broadcastLibrary()
      return { ok: true, kind: created.kind, name: created.name }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  return { enricher }
}
