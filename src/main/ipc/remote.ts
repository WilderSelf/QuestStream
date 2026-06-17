import { IPC } from '../../shared/ipc'
import type { RemoteInfo, RemoteState, RemoteCommand } from '../../shared/types'
import { RemoteServer, lanIp } from '../remote/server'
import type { Config } from '../config'
import type { IpcContext } from './context'

/**
 * Owns the LAN remote server and its interplay with persisted config. Kept separate from
 * the rest of the IPC layer because it's the only network-listening, security-sensitive
 * surface — concentrating it here makes it easy to audit and hard to entangle.
 */
export class RemoteController {
  private readonly server: RemoteServer

  constructor(
    private readonly config: Config,
    sendCommand: (cmd: RemoteCommand) => void
  ) {
    this.server = new RemoteServer(config.remotePort)
    this.server.onCommand = sendCommand
  }

  setState(state: RemoteState): void {
    this.server.setState(state)
  }

  /**
   * Status + a fresh pairing link. NOTE: this deliberately MINTS a new single-use pairing
   * code each call — the Settings UI shows a fresh QR every time it's opened/refreshed, and
   * the long-lived token is never placed in the URL. The only caller is that pairing UI.
   */
  pairingView(error?: string): RemoteInfo {
    const enabled = this.server.running
    const ip = lanIp()
    const url =
      enabled && ip ? `http://${ip}:${this.config.remotePort}/?pair=${this.server.newPairingCode(Date.now())}` : null
    return { enabled, port: this.config.remotePort, url, error }
  }

  /** Start the server with the (lazily-minted) token. Returns an error string on bind failure. */
  private async start(): Promise<string | undefined> {
    try {
      await this.server.start(this.config.remoteToken)
      return undefined
    } catch (err) {
      return (err as Error).message
    }
  }

  async setEnabled(on: boolean): Promise<RemoteInfo> {
    if (on) {
      const error = await this.start()
      this.config.remoteEnabled = !error // don't persist "enabled" if the bind failed
      return this.pairingView(error)
    }
    this.server.stop()
    this.config.remoteEnabled = false
    return this.pairingView()
  }

  /** Reveal the raw bearer token (running only) for a Stream Deck / non-browser HTTP client. */
  token(): string | null {
    return this.server.running ? this.config.remoteToken : null
  }

  /** Rotate the token (unpairs every device) and restart the server if it's up. */
  async resetToken(): Promise<RemoteInfo> {
    this.config.regenerateRemoteToken()
    if (this.server.running) {
      this.server.stop()
      const error = await this.start()
      this.config.remoteEnabled = !error
      return this.pairingView(error)
    }
    return this.pairingView()
  }

  /** On boot, start if previously enabled; clear the flag if the bind fails. */
  bootIfEnabled(): void {
    if (!this.config.remoteEnabled) return
    void this.start().then((error) => {
      if (error) this.config.remoteEnabled = false
    })
  }

  dispose(): void {
    this.server.stop()
  }
}

export function registerRemoteIpc(ctx: IpcContext): { dispose: () => void } {
  const controller = new RemoteController(ctx.config, (cmd) => ctx.send(IPC.remoteCommand, cmd))
  // The renderer pushes its state snapshot; the server serves it at /api/state.
  ctx.on(IPC.remotePushState, (_e, state: RemoteState) => controller.setState(state))
  ctx.handle(IPC.remoteGetInfo, () => controller.pairingView())
  ctx.handle(IPC.remoteSetEnabled, (_e, on: boolean) => controller.setEnabled(on))
  ctx.handle(IPC.remoteGetToken, () => controller.token())
  ctx.handle(IPC.remoteResetToken, () => controller.resetToken())
  controller.bootIfEnabled()
  return { dispose: () => controller.dispose() }
}
