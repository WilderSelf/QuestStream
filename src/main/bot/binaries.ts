import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * When the app is packaged (e.g. Flatpak), yt-dlp/ffmpeg/deno are bundled alongside
 * the app instead of installed on the host. electron-builder places extraResources
 * under `process.resourcesPath/bin`; a hand-rolled Flatpak uses `/app/bin`. In dev,
 * neither exists and we fall back to ~/.local/bin (see resolveBinary).
 */
function detectBundledBinDir(): string | null {
  const candidates = [
    typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin') : null,
    '/app/bin'
  ].filter((p): p is string => !!p)
  for (const dir of candidates) if (existsSync(dir)) return dir
  return null
}

/** Directory of bundled external tools when packaged, else null. */
export const BIN_DIR = detectBundledBinDir()

/**
 * Resolve an external binary. GUI-launched Electron may not inherit the login
 * shell PATH, so we check the bundled dir and explicit install locations before
 * falling back to the bare name (which relies on PATH).
 */
function resolveBinary(name: string, envVar: string): string {
  const fromEnv = process.env[envVar]
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  const candidates = [
    BIN_DIR ? join(BIN_DIR, name) : null,
    join(homedir(), '.local', 'bin', name),
    join('/usr/local/bin', name),
    join('/usr/bin', name)
  ].filter((p): p is string => !!p)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return name // last resort: rely on PATH
}

export const YT_DLP = resolveBinary('yt-dlp', 'QUESTSTREAM_YTDLP_PATH')
export const FFMPEG = resolveBinary('ffmpeg', 'QUESTSTREAM_FFMPEG_PATH')
export const FFPROBE = resolveBinary('ffprobe', 'QUESTSTREAM_FFPROBE_PATH')

/**
 * The external tools we couldn't resolve to a real file (so playback/import would fail).
 * A bare-name fallback (relying on PATH) counts as missing — better to warn than silently
 * fail. In a packaged Flatpak these always resolve to bundled paths under /app/bin.
 */
export function missingBinaries(): string[] {
  return (
    [
      ['yt-dlp', YT_DLP],
      ['ffmpeg', FFMPEG],
      ['ffprobe', FFPROBE]
    ] as const
  )
    .filter(([, path]) => !existsSync(path))
    .map(([name]) => name)
}

// Measured: forcing a specific YouTube player_client (android_vr/tv/ios/web) was
// NOT faster than yt-dlp's default on average — the ~3s resolve is network-bound.
// Kept as an empty hook in case a future client proves worthwhile.
export const YT_CLIENT_ARGS: string[] = []

// PATH for spawned yt-dlp/ffmpeg so they find each other and deno (yt-dlp's JS runtime
// for some YouTube formats), whether bundled (packaged) or in ~/.local/bin (dev). Shell
// env does not reliably propagate to GUI-launched Electron, so we build it explicitly.
const EXTRA_PATH = [BIN_DIR, join(homedir(), '.local', 'bin')]
  .filter((p): p is string => !!p)
  .join(':')
export const SPAWN_ENV = { ...process.env, PATH: `${EXTRA_PATH}:${process.env.PATH ?? ''}` }
