import { ipcMain, dialog, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { LibraryStore } from '../library/store'
import type { DiscordBot } from '../bot/DiscordBot'
import type { Config } from '../config'

/**
 * Everything the per-domain IPC registrars (library / playback / remote) share.
 * `handle`/`on` wrap ipcMain and record the channel into `registered`, so the
 * orchestrator can assert full channel coverage at startup (see registerIpc).
 */
export interface IpcContext {
  store: LibraryStore
  bot: DiscordBot
  config: Config
  mediaDir: string
  appVersion: string
  getWindow: () => BrowserWindow | null
  /** Send a main → renderer event to the active window (no-op if it's gone). */
  send: (channel: string, payload: unknown) => void
  /** Push the current library snapshot to the renderer. */
  broadcastLibrary: () => void
  /** Register a request/reply handler (renderer invoke → main). */
  handle: (channel: string, fn: Parameters<typeof ipcMain.handle>[1]) => void
  /** Register a one-way listener (renderer send → main). */
  on: (channel: string, fn: Parameters<typeof ipcMain.on>[1]) => void
  /** File dialogs anchored to the window when present (parameterless overload otherwise). */
  openDialog: (opts: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  saveDialog: (opts: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>
}

/** Build the shared context + the set of channels actually wired (for the coverage guard). */
export function makeContext(
  base: Omit<IpcContext, 'send' | 'broadcastLibrary' | 'handle' | 'on' | 'openDialog' | 'saveDialog'>
): { ctx: IpcContext; registered: Set<string> } {
  const registered = new Set<string>()
  const send: IpcContext['send'] = (channel, payload) => {
    const win = base.getWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
  const ctx: IpcContext = {
    ...base,
    send,
    broadcastLibrary: () => send(IPC.libraryChanged, base.store.view()),
    handle: (channel, fn) => {
      registered.add(channel)
      ipcMain.handle(channel, fn)
    },
    on: (channel, fn) => {
      registered.add(channel)
      ipcMain.on(channel, fn)
    },
    openDialog: (opts) => {
      const w = base.getWindow()
      return w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts)
    },
    saveDialog: (opts) => {
      const w = base.getWindow()
      return w ? dialog.showSaveDialog(w, opts) : dialog.showSaveDialog(opts)
    }
  }
  return { ctx, registered }
}
