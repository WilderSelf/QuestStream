import { spawn } from 'node:child_process'
import { YT_DLP, YT_CLIENT_ARGS, SPAWN_ENV } from './binaries'
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
    const child = spawn(YT_DLP, args, { windowsHide: true, env: SPAWN_ENV })
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

/** Strip the usual YouTube-title cruft: "(Official Video)", "[HD]", "Lyrics", etc. */
export function cleanTitle(t: string): string {
  return t
    .replace(/[([]\s*(official\s*)?(music\s*)?(video|audio|lyric[s]?|visualizer|mv|hd|hq|4k)\s*[)\]]/gi, '')
    .replace(/[([]\s*lyric[s]?\s*[)\]]/gi, '')
    .replace(/\bofficial\s+(music\s+)?(video|audio)\b/gi, '')
    .replace(/\s*[-|]\s*topic\s*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[-|]\s*$/, '')
    .trim()
}

/**
 * Derive clean, best-effort metadata from a yt-dlp entry, fully offline:
 * prefer YouTube Music's structured artist/album/track; otherwise parse
 * "Artist - Title" out of the video title and tidy up the channel name.
 */
export function deriveMeta(j: YtdlpJson, albumHint?: string): {
  title: string
  artistName: string
  albumTitle: string
} {
  const rawTitle = j.track || j.title || 'Untitled'
  let title = cleanTitle(rawTitle) || rawTitle
  let artist = (j.artist || j.creator || '').trim()
  const uploader = (j.uploader || j.channel || '').replace(/\s*-\s*topic\s*$/i, '').trim()

  if (!artist) {
    const parts = title.split(/\s+[-–—]\s+/)
    if (!j.track && parts.length >= 2) {
      // "Artist - Title" form
      artist = parts[0].trim()
      title = parts.slice(1).join(' - ').trim()
    } else {
      artist = uploader || 'Unknown Artist'
    }
  }

  return {
    title: title || 'Untitled',
    artistName: artist || 'Unknown Artist',
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

/** Cheaply determine whether a URL is a single video or a playlist of videos. */
export async function probe(url: string): Promise<ProbeResult> {
  // --no-playlist: a `watch?v=…&list=…` URL resolves to just that video, not the
  // whole attached playlist. A pure `playlist?list=…` URL still enumerates fully.
  const raw = await run(['-J', '--flat-playlist', '--no-playlist', '--no-warnings', ...YT_CLIENT_ARGS, '--', url])
  const j = JSON.parse(raw) as YtdlpJson
  if (j._type === 'playlist' && Array.isArray(j.entries)) {
    const entryUrls = j.entries
      .map((e) => e.webpage_url || e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : ''))
      .filter(Boolean)
    return { kind: 'playlist', playlistTitle: j.title, entryUrls }
  }
  return { kind: 'video', entryUrls: [url] }
}

/** Full metadata extraction for a single video (slower; gives artist/album). */
export async function extractTrack(url: string, albumHint?: string): Promise<ResolvedTrack> {
  const raw = await run(['-J', '--no-warnings', '--no-playlist', ...YT_CLIENT_ARGS, '--', url])
  return toTrack(JSON.parse(raw) as YtdlpJson, albumHint)
}
