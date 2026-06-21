import { useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useStore, fmtTime } from '../store'
import type { Song } from '@shared/types'
import { parseTag, labelForValue } from '@shared/taxonomy'

/**
 * Returns the set of song ids matching the current search across title, artist
 * and album. Returns `null` when there's no search (meaning "everything matches").
 */
export function useMatchingSongIds(): Set<string> | null {
  const search = useStore((s) => s.search)
  const library = useStore((s) => s.library)
  return useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const artistName = new Map(library.artists.map((a) => [a.id, a.name.toLowerCase()]))
    const albumTitle = new Map(library.albums.map((a) => [a.id, a.title.toLowerCase()]))
    const ids = new Set<string>()
    for (const s of library.songs) {
      const tags = s.tags ?? []
      if (
        s.title.toLowerCase().includes(q) ||
        artistName.get(s.artistId)?.includes(q) ||
        albumTitle.get(s.albumId)?.includes(q) ||
        tags.some((t) => t.toLowerCase().includes(q))
      )
        ids.add(s.id)
    }
    return ids
  }, [search, library])
}

export function PlaylistsPane(): JSX.Element {
  const playlists = useStore((s) => s.library.playlists)
  const scenes = useStore((s) => s.library.scenes)
  const loadPlaylist = useStore((s) => s.loadPlaylist)
  const recallScene = useStore((s) => s.recallScene)
  const loadedId = useStore((s) => s.loadedPlaylistId)
  const loadedSceneId = useStore((s) => s.loadedSceneId)
  const clearQueue = useStore((s) => s.clearQueue)
  const showNotice = useStore((s) => s.showNotice)

  async function removePlaylist(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    if (confirm('Delete this playlist?')) await window.api.playlists.remove(id)
  }
  async function removeScene(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    if (confirm('Delete this scene?')) await window.api.scenes.remove(id)
  }
  async function exportScene(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    const res = await window.api.scenes.export(id)
    if (!res.ok) showNotice(res.error ?? 'Export failed', 'error')
  }
  async function exportPlaylist(id: string, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    const res = await window.api.playlists.export(id)
    if (!res.ok) showNotice(res.error ?? 'Export failed', 'error')
  }
  async function importPack(): Promise<void> {
    const res = await window.api.packs.import()
    if (!res.ok) showNotice(res.error ?? 'Import failed', 'error')
    else if (res.name) showNotice(`Imported ${res.kind} “${res.name}”`, 'info')
  }

  return (
    <div className="pane">
      <div className="pane-header">
        <span>Scenes &amp; Playlists</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="icon" title="Import a shared pack (.questpack)" onClick={() => void importPack()}>
            📥
          </button>
          <button className="icon" title="New / clear queue" onClick={clearQueue}>
            ✚
          </button>
        </span>
      </div>
      <div className="pane-body">
        <div className="section-label">🎬 Scenes</div>
        {scenes.length === 0 && (
          <div className="muted small">
            Save a full mix (music + ambience + volumes) as a scene, then recall it in one click.
          </div>
        )}
        {scenes.map((sc) => (
          <div
            key={sc.id}
            className={`row playlist-row scene-row ${loadedSceneId === sc.id ? 'selected' : ''}`}
            title="Recall this scene (crossfades)"
            onClick={() => recallScene(sc.id)}
          >
            <div className="title">
              <div className="title">🎬 {sc.name}</div>
              <div className="sub">
                {sc.songIds.length} tracks · {sc.ambience.length} layers
              </div>
            </div>
            <button className="remove-btn" title="Export pack" onClick={(e) => void exportScene(sc.id, e)}>
              📤
            </button>
            <button className="remove-btn" title="Delete" onClick={(e) => void removeScene(sc.id, e)}>
              🗑
            </button>
          </div>
        ))}

        <div className="section-label">♪ Playlists</div>
        {playlists.length === 0 && (
          <div className="muted small">Build a queue, then “Save as playlist”.</div>
        )}
        {playlists.map((p) => (
          <div
            key={p.id}
            className={`row playlist-row ${loadedId === p.id ? 'selected' : ''}`}
            onClick={() => loadPlaylist(p.id)}
          >
            <div className="title">
              <div className="title">{p.name}</div>
              <div className="sub">{p.songIds.length} tracks</div>
            </div>
            <button className="remove-btn" title="Export pack" onClick={(e) => void exportPlaylist(p.id, e)}>
              📤
            </button>
            <button
              className="remove-btn"
              title="Delete"
              onClick={(e) => void removePlaylist(p.id, e)}
            >
              🗑
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ArtistsPane(): JSX.Element {
  const artists = useStore((s) => s.library.artists)
  const songs = useStore((s) => s.library.songs)
  const selected = useStore((s) => s.selectedArtistId)
  const selectArtist = useStore((s) => s.selectArtist)
  const matching = useMatchingSongIds()

  const sorted = useMemo(() => {
    let list = artists
    if (matching) {
      const artistsWithMatch = new Set(
        songs.filter((s) => matching.has(s.id)).map((s) => s.artistId)
      )
      list = artists.filter((a) => artistsWithMatch.has(a.id))
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [artists, songs, matching])

  return (
    <div className="pane">
      <div className="pane-header">
        <span>Artists</span>
        <span className="duration">{artists.length}</span>
      </div>
      <div className="pane-body">
        {sorted.length === 0 && (
          <div className="muted">Your library is empty. Paste a YouTube URL up top to begin.</div>
        )}
        {sorted.map((a) => (
          <div
            key={a.id}
            className={`row ${selected === a.id ? 'selected' : ''}`}
            onClick={() => selectArtist(a.id)}
          >
            <span className="title">{a.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AlbumsPane(): JSX.Element {
  const albums = useStore((s) => s.library.albums)
  const songs = useStore((s) => s.library.songs)
  const artistId = useStore((s) => s.selectedArtistId)
  const selected = useStore((s) => s.selectedAlbumId)
  const selectAlbum = useStore((s) => s.selectAlbum)
  const matching = useMatchingSongIds()

  const list = useMemo(() => {
    let albumsWithMatch: Set<string> | null = null
    if (matching) {
      albumsWithMatch = new Set(songs.filter((s) => matching.has(s.id)).map((s) => s.albumId))
    }
    return albums
      .filter((a) => a.artistId === artistId && (!albumsWithMatch || albumsWithMatch.has(a.id)))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [albums, songs, artistId, matching])
  const count = (albumId: string): number => songs.filter((s) => s.albumId === albumId).length

  return (
    <div className="pane">
      <div className="pane-header">
        <span>Albums</span>
        <span className="duration">{list.length}</span>
      </div>
      <div className="pane-body">
        {!artistId && <div className="muted">Select an artist.</div>}
        {artistId && list.length === 0 && <div className="muted">No albums.</div>}
        {list.map((al) => (
          <div
            key={al.id}
            className={`row ${selected === al.id ? 'selected' : ''}`}
            onClick={() => selectAlbum(al.id)}
          >
            {al.thumbnail ? (
              <img className="thumb" src={al.thumbnail} alt="" />
            ) : (
              <div className="thumb" />
            )}
            <div className="title">
              <div className="title">{al.title}</div>
              <div className="sub">{count(al.id)} tracks</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Format a stored tag for display: namespaced → its value label, free → as-is. */
function tagLabel(tag: string): string {
  const { dim, value } = parseTag(tag)
  return dim ? labelForValue(dim, value) : value
}

export function SongRow({ song }: { song: Song }): JSX.Element {
  const enqueueSongs = useStore((s) => s.enqueueSongs)
  const addAmbience = useStore((s) => s.addAmbience)
  const setEditSong = useStore((s) => s.setEditSong)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `song:${song.id}`,
    data: { song }
  })

  function edit(e: React.MouseEvent): void {
    e.stopPropagation()
    setEditSong(song.id)
  }
  async function del(e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    if (confirm(`Remove “${song.title}” from library?`))
      await window.api.library.deleteSong(song.id)
  }

  // Double-click sends the item to its natural place in the live mix, by kind:
  // ambience → a looping layer, sfx → a soundboard one-shot, otherwise the queue.
  function activate(): void {
    if (song.kind === 'ambience') addAmbience(song)
    else if (song.kind === 'sfx') void window.api.soundboard.add(song.id)
    else enqueueSongs([song])
  }
  const hint =
    song.kind === 'ambience'
      ? 'Drag to the mix · double-click to add a looping layer'
      : song.kind === 'sfx'
        ? 'Drag to the soundboard · double-click to add a one-shot'
        : 'Drag to queue · double-click to enqueue'

  return (
    <div
      ref={setNodeRef}
      className={`row song ${isDragging ? 'dragging' : ''}`}
      title={hint}
      {...listeners}
      {...attributes}
      onDoubleClick={activate}
    >
      <div className="title">
        <div className="title">{song.title}</div>
        {song.tags && song.tags.length > 0 && (
          <div className="song-tags">{song.tags.map(tagLabel).join(' · ')}</div>
        )}
      </div>
      <span className="duration">{fmtTime(song.duration)}</span>
      <button className="remove-btn" title="Edit tags & metadata" onClick={edit}>
        ✎
      </button>
      <button className="remove-btn" title="Delete" onClick={(e) => void del(e)}>
        🗑
      </button>
    </div>
  )
}

export function SongsPane(): JSX.Element {
  const songs = useStore((s) => s.library.songs)
  const albumId = useStore((s) => s.selectedAlbumId)
  const enqueueSongs = useStore((s) => s.enqueueSongs)
  const matching = useMatchingSongIds()

  const list = useMemo(
    () => songs.filter((s) => s.albumId === albumId && (!matching || matching.has(s.id))),
    [songs, albumId, matching]
  )

  return (
    <div className="pane">
      <div className="pane-header">
        <span>Songs</span>
        {list.length > 0 && (
          <button className="icon" title="Add all to queue" onClick={() => enqueueSongs(list)}>
            ＋ all
          </button>
        )}
      </div>
      <div className="pane-body">
        {!albumId && <div className="muted">Select an album.</div>}
        {albumId && list.length === 0 && <div className="muted">No songs.</div>}
        {list.map((s) => (
          <SongRow key={s.id} song={s} />
        ))}
      </div>
    </div>
  )
}
