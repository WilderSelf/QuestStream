import { type BrowserWindow } from 'electron'
import { IPC, MAIN_HANDLED_CHANNELS } from '../../shared/ipc'
import { LibraryStore } from '../library/store'
import { DiscordBot } from '../bot/DiscordBot'
import { Config } from '../config'
import { makeContext } from './context'
import { registerLibraryIpc } from './library'
import { registerPlaybackIpc } from './playback'
import { registerRemoteIpc } from './remote'

interface Deps {
  store: LibraryStore
  bot: DiscordBot
  config: Config
  mediaDir: string
  userData: string
  appVersion: string
  getWindow: () => BrowserWindow | null
}

/**
 * Wire every renderer↔main channel. The work is split across cohesive domain modules
 * (library/playback/remote); this orchestrator just builds the shared context, forwards
 * bot events, and asserts full channel coverage so a future split can't silently drop one.
 */
export function registerIpc(deps: Deps): { dispose: () => void } {
  const { ctx, registered } = makeContext(deps)

  // ---- forward bot/player events to the renderer ----
  ctx.bot.on('botStatus', (s) => ctx.send(IPC.discordStatus, s))
  ctx.bot.on('playerStatus', (s) => ctx.send(IPC.playerStatus, s))
  ctx.bot.on('ended', (songId) => ctx.send(IPC.playerEnded, songId))
  ctx.bot.on('monitorPcm', (pcm) => ctx.send(IPC.monitorPcm, pcm))
  ctx.bot.on('notice', (n) => ctx.send(IPC.notice, n))

  registerLibraryIpc(ctx)
  registerPlaybackIpc(ctx)
  const remote = registerRemoteIpc(ctx)

  // Coverage guard: every renderer→main channel must be wired exactly once. Catches a
  // dropped/duplicated handler at launch if the IPC layer is refactored.
  const missing = MAIN_HANDLED_CHANNELS.filter((c) => !registered.has(c))
  const extra = [...registered].filter((c) => !MAIN_HANDLED_CHANNELS.includes(c))
  if (missing.length || extra.length) {
    throw new Error(`IPC channel coverage mismatch — missing: [${missing}] extra: [${extra}]`)
  }

  return { dispose: () => remote.dispose() }
}
