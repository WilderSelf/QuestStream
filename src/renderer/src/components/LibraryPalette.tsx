import { useMemo, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useStore, fmtTime } from '../store'
import type { ItemKind, Song } from '@shared/types'
import { KIND_ORDER, KIND_LABELS } from '@shared/taxonomy'
import { Icon } from './Icon'
import { SegmentedControl } from './SegmentedControl'

/**
 * The builder's compact library browser. Unlike the full LibraryPane, activation
 * here adds to the DRAFT (by kind: track → music list, ambience → layer,
 * sfx → pad) — never to the live queue. Rows drag with the same `song:` ids the
 * library uses, so the App-level DndContext routes them; drops on builder targets
 * edit the draft, and only an explicit drop on the live margin touches the mix.
 */
function PaletteRow({ song, onAdd }: { song: Song; onAdd: (song: Song) => void }): JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `song:${song.id}`,
    data: { song }
  })
  const dest =
    song.kind === 'ambience' ? 'an ambience layer' : song.kind === 'sfx' ? 'a sound pad' : 'the track list'
  return (
    <div
      ref={setNodeRef}
      className={`row palette-row ${isDragging ? 'dragging' : ''}`}
      title={`Drag into the scene · double-click to add to ${dest}`}
      {...listeners}
      {...attributes}
      onDoubleClick={() => onAdd(song)}
    >
      <div className="title">
        <span className="song-title">{song.title}</span>
      </div>
      <span className="sub palette-duration">{fmtTime(song.duration)}</span>
      <button
        className="icon palette-add"
        title={`Add to ${dest}`}
        aria-label={`Add ${song.title} to ${dest}`}
        onClick={(e) => {
          e.stopPropagation()
          onAdd(song)
        }}
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}

export function LibraryPalette({ onAdd }: { onAdd: (song: Song) => void }): JSX.Element {
  const songs = useStore((s) => s.library.songs)
  const [kind, setKind] = useState<ItemKind>('track')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return songs.filter(
      (s) => (s.kind ?? 'track') === kind && (!q || s.title.toLowerCase().includes(q))
    )
  }, [songs, kind, query])

  return (
    <aside className="palette" aria-label="Library palette">
      <div className="section-label">
        <Icon name="book-open" size={13} /> Library
      </div>
      <SegmentedControl<ItemKind>
        options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
        value={kind}
        onChange={setKind}
      />
      <div className="palette-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          placeholder="Filter…"
          value={query}
          aria-label="Filter the library palette"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="palette-list">
        {visible.length === 0 && <div className="muted small">Nothing here matches.</div>}
        {visible.map((s) => (
          <PaletteRow key={s.id} song={s} onAdd={onAdd} />
        ))}
      </div>
      <div className="palette-hint">
        Drag anything onto the scene → double-click sends it to the right section by type.
      </div>
    </aside>
  )
}
