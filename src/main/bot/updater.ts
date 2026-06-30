import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ToolUpdateResult } from '../../shared/types'
import { setDownloadedYtDlp, SPAWN_ENV } from './binaries'
import { atomicWriteFile } from '../fsutil'

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

/**
 * The published SHA-256 for `asset`, from the release's `SHA2-256SUMS` manifest, or null
 * if it can't be fetched/parsed. yt-dlp signs every release with this manifest, so verifying
 * the download against it closes the "MITM (or compromised asset) → arbitrary executable that
 * we chmod +x and run" hole — without it the only check was that the bytes ran `--version`.
 */
async function expectedSha256(asset: string): Promise<string | null> {
  try {
    const res = await fetch(`${RELEASE_BASE}/SHA2-256SUMS`, { redirect: 'follow' })
    if (!res.ok) return null
    for (const line of (await res.text()).split('\n')) {
      const [hash, name] = line.trim().split(/\s+/)
      if (name === asset && /^[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase()
    }
  } catch {
    // network/parse failure — treated as "unverifiable" by the caller (fails closed)
  }
  return null
}

/**
 * The GitHub release asset to fetch for the current platform. The Linux/macOS builds
 * are self-contained (no Python needed); Windows ships an .exe.
 */
function assetName(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe'
  if (process.platform === 'darwin') return 'yt-dlp_macos'
  return 'yt-dlp_linux'
}

function localName(): string {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
}

function probeVersion(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const child = spawn(path, ['--version'], { env: SPAWN_ENV })
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.on('error', () => resolve(undefined))
      child.on('close', () => resolve(out.trim() || undefined))
    } catch {
      resolve(undefined)
    }
  })
}

/**
 * Download the latest yt-dlp into `toolsDir` (the app's writable userData/bin) and make
 * the app prefer it. Returns the new version on success. Atomic: writes to a temp file
 * then renames, so a half-finished download can't replace a working binary.
 */
export async function updateYtDlp(toolsDir: string): Promise<ToolUpdateResult> {
  const asset = assetName()
  try {
    const res = await fetch(`${RELEASE_BASE}/${asset}`, { redirect: 'follow' })
    if (!res.ok) return { ok: false, error: `download failed (HTTP ${res.status})` }
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length < 1024) return { ok: false, error: 'downloaded file looks empty' }

    // Verify the download against the release's signed checksum manifest BEFORE we make it
    // executable or switch over to it. Fail closed if the checksum can't be obtained.
    const want = await expectedSha256(asset)
    if (!want) return { ok: false, error: 'could not verify the download (no checksum available)' }
    const got = createHash('sha256').update(bytes).digest('hex')
    if (got !== want) return { ok: false, error: 'checksum mismatch — refusing to install' }

    const dest = join(toolsDir, localName())
    atomicWriteFile(dest, bytes, { mode: 0o755 })

    const version = await probeVersion(dest)
    if (!version) return { ok: false, error: 'downloaded yt-dlp did not run' }
    setDownloadedYtDlp(dest) // only switch over once we've confirmed it runs
    return { ok: true, version }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
