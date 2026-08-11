import { IPC } from '../../shared/ipc'
import { PreviewEngine } from '../bot/PreviewEngine'
import type { PreviewRequest } from '../../shared/types'
import type { IpcContext } from './context'

/**
 * Preview-bus IPC: the GM-only audition path. Deliberately wired to the
 * PreviewEngine alone — never to the live bot — so previewing can't touch what
 * the table hears (pinned by tests/preview-isolation.test.ts).
 */
export function registerPreviewIpc(ctx: IpcContext): { dispose: () => void } {
  const { handle, send } = ctx

  // Lazy: most sessions never preview; don't hold an engine (or its buffers) until asked.
  let engine: PreviewEngine | null = null
  const getEngine = (): PreviewEngine =>
    (engine ??= new PreviewEngine({
      onPcm: (pcm) => send(IPC.previewPcm, pcm),
      onStatus: (s) => send(IPC.previewStatus, s)
    }))

  handle(IPC.previewStart, (_e, request: PreviewRequest) => getEngine().start(request, Date.now()))
  handle(IPC.previewStop, () => engine?.stop())
  handle(IPC.previewSetVolume, (_e, volume: number) => engine?.setVolume(volume))

  return { dispose: () => engine?.stop() }
}
