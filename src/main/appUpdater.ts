import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type { UpdateState } from '../shared/types'

// electron + electron-updater are imported lazily (inside the functions) so this module
// stays importable in the headless IPC tests, which run without an electron runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAutoUpdater(): Promise<any> {
  const mod = (await import('electron-updater')) as { default?: { autoUpdater: unknown }; autoUpdater?: unknown }
  return (mod.default ?? mod).autoUpdater
}

/**
 * Wire electron-updater to the renderer. Downloads updates in the background and tells
 * the renderer when one is ready so the user can restart into it (see UpdateBanner).
 *
 * Only runs for a packaged build with an update feed (the AppImage embeds app-update.yml
 * from electron-builder's `publish` config). In dev there's no feed, so we no-op rather
 * than spew "checkForUpdates is disabled" errors.
 */
export async function initAutoUpdater(getWindow: () => BrowserWindow | null): Promise<void> {
  const { app } = await import('electron')
  if (!app.isPackaged) return

  const send = (s: UpdateState): void => {
    const w = getWindow()
    if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(IPC.updateStatus, s)
  }

  const autoUpdater = await getAutoUpdater()
  autoUpdater.autoDownload = true // fetch in the background as soon as one is found
  autoUpdater.autoInstallOnAppQuit = true // also apply on next quit if they don't restart now

  autoUpdater.on('checking-for-update', () => send({ phase: 'checking' }))
  autoUpdater.on('update-available', (i: { version: string }) => send({ phase: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => send({ phase: 'idle' }))
  autoUpdater.on('download-progress', (p: { percent: number }) =>
    send({ phase: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (i: { version: string }) => send({ phase: 'downloaded', version: i.version }))
  autoUpdater.on('error', (e: Error) => send({ phase: 'error', message: e.message }))

  void autoUpdater.checkForUpdates().catch(() => {
    /* offline / no release yet — the error event already notified the renderer */
  })
}

/** Manual "check now" (Settings). Safe to call repeatedly. */
export async function checkForUpdates(): Promise<void> {
  const { app } = await import('electron')
  if (!app.isPackaged) return
  const autoUpdater = await getAutoUpdater()
  await autoUpdater.checkForUpdates().catch(() => {})
}

/** Quit and install a downloaded update (renderer's "Restart to update"). */
export async function quitAndInstall(): Promise<void> {
  const autoUpdater = await getAutoUpdater()
  autoUpdater.quitAndInstall()
}
