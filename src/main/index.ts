import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { AppNotice } from '../shared/types'
import { LibraryStore } from './library/store'
import { seedFromLegacyProfile } from './library/migrate'
import { mediaDirFor, sweepMediaTemp } from './library/media'
import { missingBinaries, setDownloadedYtDlp, setCookieArgs } from './bot/binaries'
import { buildCookieArgs } from './bot/cookies'
import { initAutoUpdater } from './appUpdater'
import { DiscordBot } from './bot/DiscordBot'
import { Config } from './config'
import { registerIpc } from './ipc/handlers'

// Last-resort logging so a stray throw/rejection doesn't kill the app silently. These are
// safety nets, not control flow — the real error handling lives at each call site.
process.on('uncaughtException', (err) => console.error('[fatal] uncaughtException:', err))
process.on('unhandledRejection', (reason) => console.error('[fatal] unhandledRejection:', reason))

let mainWindow: BrowserWindow | null = null
let bot: DiscordBot | null = null
let store: LibraryStore | null = null
let ipcHandle: { dispose: () => void } | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#2e3440',
    autoHideMenuBar: true,
    title: 'QuestStream',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // sandbox MUST stay false here: electron-vite builds the preload as an ESM module
      // (index.mjs, because package.json is "type": "module"), and Electron cannot load
      // an ESM preload in a sandboxed renderer — doing so silently breaks the
      // contextBridge so window.api is undefined (blank library, nothing works).
      // Enabling sandbox would require emitting a CommonJS (.cjs) preload first.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // If the renderer crashes, log it and recover (a clean exit is the normal shutdown path).
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', details.reason)
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload()
    }
  })

  // Warn once if the external tools aren't bundled/findable — otherwise the first play just
  // fails cryptically. Delayed so the renderer's notice subscription (store.init) is ready.
  mainWindow.webContents.on('did-finish-load', () => {
    const missing = missingBinaries()
    if (missing.length === 0) return
    setTimeout(() => {
      const notice: AppNotice = {
        message: `${missing.join(' + ')} not found — playback won't work. See the README's "External tools" section.`,
        kind: 'error',
        persistent: true // a missing tool is a standing condition, not a passing event
      }
      mainWindow?.webContents.send(IPC.notice, notice)
    }, 1500)
  })

  // open external links in the system browser, never in-app — and only http(s), so a
  // data-driven link can never smuggle a file:/javascript: URL into the shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The app is a single local document. Block any attempt to navigate the privileged
  // window to another origin (a compromised renderer could otherwise load remote code
  // into a context that has the preload attached). Allow only the Vite dev server.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  // If this profile is new (e.g. after an app rename moved userData), seed it from the
  // richest legacy profile so the user's library doesn't appear to vanish.
  seedFromLegacyProfile(userData)
  const mediaDir = mediaDirFor(userData)
  sweepMediaTemp(mediaDir) // clear any orphaned import temp files from a prior crash
  // Prefer a previously-downloaded yt-dlp (from the "Update yt-dlp" action) if present.
  setDownloadedYtDlp(join(userData, 'bin', 'yt-dlp'))
  store = new LibraryStore(join(userData, 'library.json'))
  const config = new Config(join(userData, 'config.json'))
  // Apply the saved yt-dlp cookie source (if any) before the first import/playback.
  setCookieArgs(buildCookieArgs({ mode: config.cookiesMode, browser: config.cookiesBrowser, userData }))
  bot = new DiscordBot(mediaDir)

  ipcHandle = registerIpc({
    store,
    bot,
    config,
    mediaDir,
    userData,
    appVersion: app.getVersion(),
    getWindow: () => mainWindow
  })
  createWindow()
  // background update checks (packaged builds only); never let a setup failure crash startup
  void initAutoUpdater(() => mainWindow).catch((e) => console.error('[update] init failed', e))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  store?.flush() // persist any debounced library mutation before exit
  bot?.dispose()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  store?.flush()
  bot?.dispose()
  ipcHandle?.dispose()
})
