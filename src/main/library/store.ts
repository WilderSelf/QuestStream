import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, renameSync } from 'node:fs'
import { atomicWriteFile } from '../fsutil'
import type {
  LibrarySnapshot,
  Artist,
  Album,
  Song,
  Playlist,
  Scene,
  SoundboardItem,
  RetagPayload,
  SourceType,
  ItemKind
} from '../../shared/types'
import { normalizeTag, remapLegacyTag } from '../../shared/taxonomy'

/** Bump when a new one-time tag migration must run against existing libraries. */
const TAGS_SCHEMA = 1

interface DbShape {
  artists: Artist[]
  albums: Album[]
  songs: Song[]
  playlists: Playlist[]
  scenes: Scene[]
  soundboard: SoundboardItem[]
  /** Highest tag-migration schema already applied to this file (see migrateTagsOnce). */
  tagsSchema?: number
}

const EMPTY: DbShape = {
  artists: [],
  albums: [],
  songs: [],
  playlists: [],
  scenes: [],
  soundboard: []
}

const norm = (s: string): string => s.trim().toLowerCase()

/**
 * A tiny normalized JSON store for the music library. Chosen over SQLite so the
 * app needs no native modules (no compiler available in this environment).
 * The whole library is held in memory and flushed atomically on every mutation.
 */
export class LibraryStore {
  private db: DbShape
  private writeTimer: NodeJS.Timeout | null = null

  constructor(private readonly path: string) {
    this.db = this.load()
    this.migrateTagsOnce()
  }

  /**
   * Remap tags saved under retired taxonomy dimensions to the unified scheme, exactly once
   * per library (guarded by the persisted `tagsSchema` marker). Idempotent by construction
   * — remapLegacyTag passes through anything already migrated — but the marker also avoids
   * re-scanning the whole library on every launch and re-touching tags the user may have
   * deliberately re-created. Writes synchronously so the marker survives even if the app
   * quits before the next mutation.
   */
  private migrateTagsOnce(): void {
    if ((this.db.tagsSchema ?? 0) >= TAGS_SCHEMA) return
    for (const s of this.db.songs) {
      s.tags = this.normalizeTags((s.tags ?? []).map(remapLegacyTag))
    }
    this.db.tagsSchema = TAGS_SCHEMA
    this.writeNow()
  }

  private load(): DbShape {
    try {
      if (existsSync(this.path)) {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<DbShape>
        const db = { ...structuredClone(EMPTY), ...parsed }
        // migrate: ensure every song has a tags array + a source type + a kind
        db.songs.forEach((s) => {
          if (!Array.isArray(s.tags)) s.tags = []
          if (!s.sourceType) s.sourceType = 'youtube'
          if (!s.kind) s.kind = 'track'
        })
        if (!Array.isArray(db.soundboard)) db.soundboard = []
        // Songs referenced by a soundboard item are one-shots → classify them as 'sfx'
        // so they land in the Soundboard pane. Runs after the default so it wins.
        const sfxIds = new Set(db.soundboard.map((sb) => sb.songId))
        db.songs.forEach((s) => {
          if (sfxIds.has(s.id)) s.kind = 'sfx'
        })
        return db
      }
    } catch (err) {
      console.error('[library] failed to load, starting empty:', err)
      this.backupCorrupt()
    }
    return structuredClone(EMPTY)
  }

  /**
   * Preserve an unreadable library file before we start empty — otherwise the next
   * mutation's persist() would clobber the (possibly recoverable) file with `{}`.
   */
  private backupCorrupt(): void {
    try {
      if (existsSync(this.path)) {
        const bak = `${this.path}.corrupt-${Date.now()}`
        renameSync(this.path, bak)
        console.error(`[library] preserved unreadable file → ${bak}`)
      }
    } catch (err) {
      console.error('[library] could not back up corrupt file:', err)
    }
  }

  /** Atomic write (write to temp then rename). */
  private writeNow(): void {
    try {
      atomicWriteFile(this.path, JSON.stringify(this.db, null, 2))
    } catch (err) {
      console.error('[library] failed to persist:', err)
    }
  }

  /** Debounced atomic write. */
  private persist(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.writeNow()
    }, 150)
  }

  /**
   * Flush any pending debounced write synchronously. Call on app quit — otherwise a
   * mutation within the 150ms debounce window (a final retag/delete/import) is lost.
   */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
      this.writeNow()
    }
  }

  /** A deep, isolated copy — for callers that keep or mutate the result. */
  snapshot(): LibrarySnapshot {
    return structuredClone(this.db)
  }

  /**
   * The live DB as a read-only view (NO clone). Use for the IPC send path —
   * `webContents.send` structure-clones at the boundary anyway, so cloning here too is
   * wasteful — and for internal read-only consumers. Never mutate the returned object.
   */
  view(): LibrarySnapshot {
    return this.db
  }

  /** Look up a single song (live reference; do not mutate). */
  getSong(songId: string): Song | undefined {
    return this.db.songs.find((s) => s.id === songId)
  }

  /** Look up a single soundboard item (live reference; do not mutate). */
  getSoundboardItem(id: string): SoundboardItem | undefined {
    return this.db.soundboard.find((s) => s.id === id)
  }

  private findOrCreateArtist(name: string): Artist {
    const existing = this.db.artists.find((a) => norm(a.name) === norm(name))
    if (existing) return existing
    const artist: Artist = { id: randomUUID(), name: name.trim() || 'Unknown Artist' }
    this.db.artists.push(artist)
    return artist
  }

  private findOrCreateAlbum(artistId: string, title: string, thumbnail?: string): Album {
    const existing = this.db.albums.find(
      (a) => a.artistId === artistId && norm(a.title) === norm(title)
    )
    if (existing) {
      if (!existing.thumbnail && thumbnail) existing.thumbnail = thumbnail
      return existing
    }
    const album: Album = {
      id: randomUUID(),
      artistId,
      title: title.trim() || 'Unknown Album',
      thumbnail
    }
    this.db.albums.push(album)
    return album
  }

  /** Whether a song with this videoId already exists (import paths use it to avoid
   * re-tagging or re-counting a song that addSong would de-dupe away). */
  hasSong(videoId: string): boolean {
    return this.db.songs.some((s) => s.videoId === videoId)
  }

  /** Insert a resolved track. De-dupes by videoId. Returns the song (existing or new). */
  addSong(input: {
    videoId: string
    url: string
    title: string
    artistName: string
    albumTitle: string
    duration: number
    thumbnail?: string
    sourceType?: SourceType
    kind?: ItemKind
    tags?: string[]
  }): Song {
    // De-dupe by videoId: re-importing must never clobber a song's existing kind/tags.
    const dupe = this.db.songs.find((s) => s.videoId === input.videoId)
    if (dupe) return dupe

    const artist = this.findOrCreateArtist(input.artistName)
    const album = this.findOrCreateAlbum(artist.id, input.albumTitle, input.thumbnail)
    const song: Song = {
      id: randomUUID(),
      albumId: album.id,
      artistId: artist.id,
      title: input.title.trim() || 'Untitled',
      url: input.url,
      videoId: input.videoId,
      duration: input.duration,
      thumbnail: input.thumbnail,
      tags: this.normalizeTags(input.tags ?? []),
      addedAt: Date.now(),
      sourceType: input.sourceType ?? 'youtube',
      kind: input.kind ?? 'track'
    }
    this.db.songs.push(song)
    this.persist()
    return song
  }

  /**
   * Normalize a tag list for storage: trim/normalize each (namespaced tags get a
   * lowercased dim+value; legacy free tags keep their case), drop empties, de-dupe
   * case-insensitively, and cap length. The cap is generous (32) because namespaced
   * taxonomy tags across several dimensions plus a few free tags add up fast — the old
   * cap of 12 would silently truncate them.
   */
  private normalizeTags(tags: string[]): string[] {
    const seen = new Set<string>()
    return tags
      .map((t) => normalizeTag(t))
      .filter((t) => {
        const k = t.toLowerCase()
        if (!t || seen.has(k)) return false
        seen.add(k)
        return true
      })
      .slice(0, 32)
  }

  retag(songId: string, payload: RetagPayload): void {
    const song = this.getSong(songId)
    if (!song) return
    if (payload.title !== undefined) song.title = payload.title.trim() || song.title
    if (payload.tags !== undefined) song.tags = this.normalizeTags(payload.tags)
    if (payload.kind !== undefined) song.kind = payload.kind

    if (payload.artistName !== undefined) {
      const artist = this.findOrCreateArtist(payload.artistName)
      song.artistId = artist.id
      // album must belong to the (possibly new) artist
      const oldAlbum = this.db.albums.find((a) => a.id === song.albumId)
      const albumTitle = payload.albumTitle ?? oldAlbum?.title ?? 'Unknown Album'
      const album = this.findOrCreateAlbum(artist.id, albumTitle, song.thumbnail)
      song.albumId = album.id
    } else if (payload.albumTitle !== undefined) {
      const album = this.findOrCreateAlbum(song.artistId, payload.albumTitle, song.thumbnail)
      song.albumId = album.id
    }

    this.gcEmpty()
    this.persist()
  }

  /** Set (or clear, with null) a song's DSP effect preset key. */
  setEffect(songId: string, effect: string | null): void {
    const song = this.getSong(songId)
    if (!song) return
    if (effect) song.effect = effect
    else delete song.effect
    this.persist()
  }

  deleteSong(songId: string): void {
    this.db.songs = this.db.songs.filter((s) => s.id !== songId)
    this.db.playlists.forEach((p) => {
      p.songIds = p.songIds.filter((id) => id !== songId)
    })
    this.db.scenes.forEach((sc) => {
      sc.songIds = sc.songIds.filter((id) => id !== songId)
      sc.ambience = sc.ambience.filter((a) => a.songId !== songId)
      sc.ambience.forEach((a) => {
        if (a.pool) a.pool = a.pool.filter((id) => id !== songId)
      })
    })
    this.db.soundboard = this.db.soundboard.filter((sb) => sb.songId !== songId)
    this.gcEmpty()
    this.persist()
  }

  // ---- soundboard ----

  addSoundboardItem(songId: string): SoundboardItem {
    const item: SoundboardItem = { id: randomUUID(), songId }
    this.db.soundboard.push(item)
    this.persist()
    return item
  }

  updateSoundboardItem(id: string, patch: Partial<Omit<SoundboardItem, 'id'>>): void {
    const item = this.getSoundboardItem(id)
    if (!item) return
    // A hotkey is unique across the board — clear it from any other item first.
    if (patch.hotkey) {
      this.db.soundboard.forEach((s) => {
        if (s.id !== id && s.hotkey === patch.hotkey) delete s.hotkey
      })
    }
    Object.assign(item, patch)
    if (patch.hotkey === '') delete item.hotkey
    this.persist()
  }

  removeSoundboardItem(id: string): void {
    this.db.soundboard = this.db.soundboard.filter((s) => s.id !== id)
    this.persist()
  }

  /** Drop albums/artists that no longer have any songs. */
  private gcEmpty(): void {
    const albumsWithSongs = new Set(this.db.songs.map((s) => s.albumId))
    this.db.albums = this.db.albums.filter((a) => albumsWithSongs.has(a.id))
    const artistsWithAlbums = new Set(this.db.albums.map((a) => a.artistId))
    this.db.artists = this.db.artists.filter((a) => artistsWithAlbums.has(a.id))
  }

  savePlaylist(name: string, songIds: string[], id?: string): Playlist {
    const now = Date.now()
    if (id) {
      const existing = this.db.playlists.find((p) => p.id === id)
      if (existing) {
        existing.name = name
        existing.songIds = songIds
        existing.updatedAt = now
        this.persist()
        return existing
      }
    }
    const playlist: Playlist = {
      id: randomUUID(),
      name,
      songIds,
      createdAt: now,
      updatedAt: now
    }
    this.db.playlists.push(playlist)
    this.persist()
    return playlist
  }

  deletePlaylist(id: string): void {
    this.db.playlists = this.db.playlists.filter((p) => p.id !== id)
    this.persist()
  }

  saveScene(scene: Omit<Scene, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Scene {
    const now = Date.now()
    if (scene.id) {
      const existing = this.db.scenes.find((s) => s.id === scene.id)
      if (existing) {
        Object.assign(existing, scene, { updatedAt: now })
        this.persist()
        return existing
      }
    }
    const created: Scene = {
      id: randomUUID(),
      name: scene.name,
      songIds: scene.songIds,
      musicVolume: scene.musicVolume,
      currentIndex: scene.currentIndex,
      ambience: scene.ambience,
      createdAt: now,
      updatedAt: now
    }
    this.db.scenes.push(created)
    this.persist()
    return created
  }

  deleteScene(id: string): void {
    this.db.scenes = this.db.scenes.filter((s) => s.id !== id)
    this.persist()
  }
}
