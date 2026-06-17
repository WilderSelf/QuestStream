import type { LibraryStore } from './store'

const MB_ENDPOINT = 'https://musicbrainz.org/ws/2/recording'
const RATE_LIMIT_MS = 1100 // MusicBrainz asks for ≤1 request/second
const MIN_SCORE = 90 // only accept high-confidence matches

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
export const lucene = (s: string): string => s.replace(/["\\]/g, ' ').replace(/[+\-!(){}[\]^~*?:]/g, ' ').trim()

interface MbRecording {
  score?: number
  'artist-credit'?: { name?: string }[]
  releases?: { title?: string; 'release-group'?: { 'primary-type'?: string } }[]
}

/**
 * Background metadata enrichment via MusicBrainz. Runs a gentle, rate-limited
 * queue; only fills generic artist/album (never overwrites good data) and marks
 * each song so it's never queried twice. Failures leave the song un-enriched to
 * retry on a future run.
 */
export class Enricher {
  private queue: string[] = []
  private running = false
  private current: string | null = null // id being processed right now (shifted off the queue)
  private readonly userAgent: string

  constructor(
    private readonly store: LibraryStore,
    private readonly onChange: () => void,
    appVersion = '0.0.0' // single-sourced from app.getVersion() (package.json) by the caller
  ) {
    // MusicBrainz asks for a descriptive User-Agent identifying the app + version.
    this.userAgent = `QuestStream/${appVersion} (local GM audio player)`
  }

  enqueue(songIds: string[]): void {
    for (const id of songIds) {
      if (id !== this.current && !this.queue.includes(id)) this.queue.push(id)
    }
    if (!this.running) void this.run()
  }

  private async run(): Promise<void> {
    this.running = true
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!
        this.current = id
        const info = this.store.getEnrichInfo(id)
        if (!info) continue // gone or already enriched
        try {
          const match = await this.lookup(info.title, info.artistName)
          const changed = match
            ? this.store.enrichSong(id, match)
            : (this.store.markEnriched(id), false)
          if (changed) this.onChange()
        } catch (err) {
          console.error('[enrich] lookup failed:', (err as Error).message)
          // leave un-enriched; it'll be retried next session
        }
        await sleep(RATE_LIMIT_MS)
      }
    } finally {
      this.current = null
      this.running = false
    }
  }

  private async lookup(
    title: string,
    artist: string
  ): Promise<{ artistName?: string; albumTitle?: string } | null> {
    const cleanTitle = lucene(title)
    const cleanArtist = lucene(artist)
    if (!cleanTitle) return null
    const hasArtist = cleanArtist && !/^unknown artist$/i.test(cleanArtist)
    const query = hasArtist
      ? `recording:(${cleanTitle}) AND artist:(${cleanArtist})`
      : `recording:(${cleanTitle})`
    const url = `${MB_ENDPOINT}?query=${encodeURIComponent(query)}&fmt=json&limit=3`

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    let data: { recordings?: MbRecording[] }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': this.userAgent }, signal: ctrl.signal })
      if (!res.ok) return null
      data = (await res.json()) as { recordings?: MbRecording[] }
    } finally {
      clearTimeout(t)
    }

    const rec = data.recordings?.[0]
    if (!rec || (rec.score ?? 0) < MIN_SCORE) return null

    const artistName = rec['artist-credit']?.[0]?.name
    // prefer an actual album release over singles/compilations where possible
    const release =
      rec.releases?.find((r) => r['release-group']?.['primary-type'] === 'Album') ??
      rec.releases?.[0]
    return { artistName, albumTitle: release?.title }
  }
}
