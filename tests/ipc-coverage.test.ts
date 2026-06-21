import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAIN_HANDLED_CHANNELS } from '../src/shared/ipc.ts'
import { registerLibraryIpc } from '../src/main/ipc/library.ts'
import { registerPlaybackIpc } from '../src/main/ipc/playback.ts'
import { registerRemoteIpc } from '../src/main/ipc/remote.ts'
import type { IpcContext } from '../src/main/ipc/context.ts'

// A recording context: the domain registrars only *register* handlers here (the handler
// bodies aren't invoked), so a minimal stub store/bot/config is enough. No electron, no
// network — `RemoteServer` is constructed but never started (config.remoteEnabled = false).
function stubContext(registered: Set<string>): IpcContext {
  const store = {
    view: () => ({ artists: [], albums: [], songs: [], playlists: [], scenes: [], soundboard: [] })
  }
  const config = { remotePort: 0, remoteEnabled: false, remoteToken: 'stub' }
  return {
    store,
    bot: {},
    config,
    mediaDir: '/tmp/quest-stub',
    appVersion: '0.0.0-test',
    getWindow: () => null,
    send: () => {},
    broadcastLibrary: () => {},
    handle: (channel: string) => registered.add(channel),
    on: (channel: string) => registered.add(channel),
    openDialog: async () => ({ canceled: true, filePaths: [] }),
    saveDialog: async () => ({ canceled: true })
  } as unknown as IpcContext
}

test('the domain modules register exactly the main-handled IPC channels', () => {
  const registered = new Set<string>()
  const ctx = stubContext(registered)
  registerLibraryIpc(ctx)
  registerPlaybackIpc(ctx)
  registerRemoteIpc(ctx)

  const missing = MAIN_HANDLED_CHANNELS.filter((c) => !registered.has(c))
  const extra = [...registered].filter((c) => !MAIN_HANDLED_CHANNELS.includes(c))
  assert.deepEqual(missing, [], `unhandled channels: ${missing}`)
  assert.deepEqual(extra, [], `unexpected channels: ${extra}`)
})
