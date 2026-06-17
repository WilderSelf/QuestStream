import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join, extname, basename, resolve, sep } from 'node:path'
import { FFPROBE, SPAWN_ENV } from '../bot/binaries'

/** Audio extensions we accept for local import (the file dialog also filters by these). */
export const AUDIO_EXTS = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma', 'aiff', 'aif']

export interface ImportedMedia {
  storedPath: string
  sha1: string
  durationSec: number
  title: string
  artist?: string
  album?: string
}

/** The app's local-media folder, derived from Electron's userData dir. */
export function mediaDirFor(userData: string): string {
  return join(userData, 'media')
}

/** True if `p` resolves inside `mediaDir` (blocks path-traversal to arbitrary files). */
export function isInMediaDir(mediaDir: string, p: string): boolean {
  const base = resolve(mediaDir)
  const target = resolve(p)
  return target === base || target.startsWith(base + sep)
}

/** Pick a safe stored extension: a known audio ext, else a neutral fallback. */
function safeExt(srcPath: string): string {
  const ext = extname(srcPath).replace(/^\./, '').toLowerCase()
  return AUDIO_EXTS.includes(ext) ? `.${ext}` : '.audio'
}

/**
 * Copy a picked audio file into the sandboxed media dir and probe its metadata.
 * Content-addressed (filename = sha1) so re-importing identical audio is a no-op and
 * dedups cleanly against the library's `local:<sha1>` videoId key. Streams the copy
 * while hashing in a single pass (never buffers the whole file in memory).
 */
export async function copyIntoMedia(mediaDir: string, srcPath: string): Promise<ImportedMedia> {
  mkdirSync(mediaDir, { recursive: true })
  const ext = safeExt(srcPath)
  const tmp = join(mediaDir, `.import-${randomUUID()}.tmp`)
  const hash = createHash('sha1')
  try {
    await pipeline(
      createReadStream(srcPath),
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk as Buffer)
          yield chunk
        }
      },
      createWriteStream(tmp)
    )
    const sha1 = hash.digest('hex')
    const storedPath = join(mediaDir, `${sha1}${ext}`)
    // Content-addressed: identical bytes already imported → drop the temp, reuse the file.
    if (existsSync(storedPath)) rmSync(tmp, { force: true })
    else renameSync(tmp, storedPath)
    const meta = await probeMeta(storedPath)
    return {
      storedPath,
      sha1,
      durationSec: meta.durationSec,
      title: meta.title || basename(srcPath, extname(srcPath)),
      artist: meta.artist,
      album: meta.album
    }
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/** Delete a stored media file, but only if it really lives under the media dir. */
export function removeMedia(mediaDir: string, storedPath: string): void {
  if (!isInMediaDir(mediaDir, storedPath)) return
  try {
    rmSync(storedPath, { force: true })
  } catch (err) {
    console.error('[media] failed to remove', storedPath, (err as Error).message)
  }
}

/** Remove orphaned import temp files (e.g. from a crash mid-copy). Call on startup. */
export function sweepMediaTemp(mediaDir: string): void {
  try {
    if (!existsSync(mediaDir)) return
    for (const name of readdirSync(mediaDir)) {
      if (/^\.import-.*\.tmp$/.test(name)) rmSync(join(mediaDir, name), { force: true })
    }
  } catch (err) {
    console.error('[media] temp sweep failed:', (err as Error).message)
  }
}

interface ProbeMeta {
  durationSec: number
  title?: string
  artist?: string
  album?: string
}

/** Async ffprobe (doesn't block the main/UI thread during a bulk import). */
function probeMeta(path: string): Promise<ProbeMeta> {
  return new Promise((resolve) => {
    const child = spawn(
      FFPROBE,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '--', path],
      { windowsHide: true, env: SPAWN_ENV }
    )
    const out: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stdout.on('error', () => {})
    child.on('error', () => resolve({ durationSec: 0 }))
    child.on('close', (code) => {
      if (code !== 0) return resolve({ durationSec: 0 })
      try {
        const j = JSON.parse(Buffer.concat(out).toString('utf8')) as {
          format?: { duration?: string; tags?: Record<string, string> }
        }
        const fmt = j.format ?? {}
        // ffprobe tag keys vary in case (TITLE vs title) by container — match insensitively.
        const tags = new Map<string, string>()
        for (const [k, v] of Object.entries(fmt.tags ?? {})) tags.set(k.toLowerCase(), v)
        const dur = Math.round(parseFloat(fmt.duration ?? '0'))
        resolve({
          durationSec: Number.isFinite(dur) ? dur : 0,
          title: tags.get('title'),
          artist: tags.get('artist') ?? tags.get('album_artist'),
          album: tags.get('album')
        })
      } catch {
        resolve({ durationSec: 0 })
      }
    })
  })
}
