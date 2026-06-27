import { spawn } from 'node:child_process'
import { ytDlp, cookieArgs, YT_CLIENT_ARGS, SPAWN_ENV } from './binaries'
import type { SourceType } from '../../shared/types'

export interface ResolvedTrack {
  videoId: string
  url: string
  title: string
  artistName: string
  albumTitle: string
  duration: number
  thumbnail?: string
  sourceType: SourceType
}

export interface ProbeResult {
  kind: 'video' | 'playlist'
  playlistTitle?: string
  entryUrls: string[]
  // For a single video, the probe's `-J` output IS the full metadata (--flat-playlist
  // is a no-op when there's no playlist to flatten), so we hand the resolved track back
  // and skip a second, redundant network resolve. Absent for playlists.
  track?: ResolvedTrack
}

export interface YtdlpJson {
  id?: string
  _type?: string
  title?: string
  track?: string
  artist?: string
  creator?: string
  uploader?: string
  channel?: string
  album?: string
  duration?: number
  thumbnail?: string
  thumbnails?: { url: string }[]
  webpage_url?: string
  release_year?: number
  entries?: { url?: string; id?: string; webpage_url?: string }[]
}

function run(args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp(), args, { windowsHide: true, env: SPAWN_ENV })
    // Collect stdout as Buffers and decode once — a per-chunk toString() can split a
    // multibyte UTF-8 char across a chunk boundary and corrupt non-ASCII titles.
    const out: Buffer[] = []
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('yt-dlp timed out'))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'))
      else reject(new Error(err.trim() || `yt-dlp exited with code ${code}`))
    })
  })
}

function pickThumbnail(j: YtdlpJson): string | undefined {
  if (j.thumbnail) return j.thumbnail
  if (j.thumbnails?.length) return j.thumbnails[j.thumbnails.length - 1].url
  return undefined
}

/**
 * Take the source's own metadata verbatim — no cruft-stripping, no "Artist - Title" parsing.
 * Imports should reflect exactly what the source reports; the user edits anything they don't
 * like in the import wizard or the item editor. Prefers YouTube Music's structured `track`
 * field when present (that IS the source's title), otherwise the video title; artist falls
 * back through the structured/uploader fields; album defaults to "Singles".
 */
export function deriveMeta(j: YtdlpJson, albumHint?: string): {
  title: string
  artistName: string
  albumTitle: string
} {
  return {
    title: (j.track || j.title || '').trim() || 'Untitled',
    artistName: (j.artist || j.creator || j.uploader || j.channel || '').trim() || 'Unknown Artist',
    albumTitle: (j.album || albumHint || 'Singles').trim()
  }
}

/** YouTube hosts get the 'youtube' source type; every other yt-dlp site is 'url'. */
function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/([^/]+\.)?(youtube\.com|youtu\.be)\b/i.test(url)
}

function toTrack(j: YtdlpJson, albumHint?: string): ResolvedTrack {
  const id = j.id ?? ''
  const meta = deriveMeta(j, albumHint)
  // Prefer yt-dlp's canonical webpage_url (correct for any extractor); fall back to a
  // YouTube watch URL only when we have a bare id and no webpage_url.
  const url = j.webpage_url || (id ? `https://www.youtube.com/watch?v=${id}` : '')
  return {
    videoId: id,
    url,
    title: meta.title,
    artistName: meta.artistName,
    albumTitle: meta.albumTitle,
    duration: Math.round(j.duration ?? 0),
    thumbnail: pickThumbnail(j),
    sourceType: isYouTubeUrl(url) ? 'youtube' : 'url'
  }
}

/**
 * Resolve a URL in a single yt-dlp call. For a single video this returns the fully
 * resolved track (no second network round-trip needed). For a real playlist URL it
 * returns the flat entry list, which the caller resolves per-entry.
 */
export async function probe(url: string, albumHint?: string): Promise<ProbeResult> {
  // --no-playlist: a `watch?v=…&list=…` URL resolves to just that video, not the
  // whole attached playlist. A pure `playlist?list=…` URL still enumerates fully.
  // --flat-playlist keeps the playlist branch cheap (entries aren't each extracted);
  // for a single video it's a no-op, so `j` carries the complete metadata.
  const raw = await run(['-J', '--flat-playlist', '--no-playlist', '--no-warnings', ...cookieArgs(), ...YT_CLIENT_ARGS, '--', url])
  const j = JSON.parse(raw) as YtdlpJson
  if (j._type === 'playlist' && Array.isArray(j.entries)) {
    const entryUrls = j.entries
      .map((e) => e.webpage_url || e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : ''))
      .filter(Boolean)
    return { kind: 'playlist', playlistTitle: j.title, entryUrls }
  }
  return { kind: 'video', entryUrls: [url], track: toTrack(j, albumHint) }
}

/** Full metadata extraction for a single video (slower; gives artist/album). */
export async function extractTrack(url: string, albumHint?: string): Promise<ResolvedTrack> {
  const raw = await run(['-J', '--no-warnings', '--no-playlist', ...cookieArgs(), ...YT_CLIENT_ARGS, '--', url])
  return toTrack(JSON.parse(raw) as YtdlpJson, albumHint)
}
