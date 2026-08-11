import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store'
import type { SceneDraft } from '@shared/scene-edit'
import type { EndOfListPolicy } from '@shared/types'
import { Icon } from './Icon'

/** Sortable ids are index-scoped so duplicate songs in a list can't collide with
 *  each other (or with the live queue's uids): `draft-song:<index>:<songId>`. */
export const DRAFT_SONG_PREFIX = 'draft-song:'
export const DRAFT_MUSIC_DROP = 'draft-music-drop'

export const draftSongId = (index: number, songId: string): string =>
  `${DRAFT_SONG_PREFIX}${index}:${songId}`

/** Parse a draft-song sortable id back to its list index (null for other ids). */
export const draftSongIndex = (id: string): number | null => {
  if (!id.startsWith(DRAFT_SONG_PREFIX)) return null
  const n = Number.parseInt(id.slice(DRAFT_SONG_PREFIX.length), 10)
  return Number.isInteger(n) && n >= 0 ? n : null
}

const END_OF_LIST_OPTIONS: { value: EndOfListPolicy; label: string }[] = [
  { value: 'stop', label: 'stop' },
  { value: 'loop-list', label: 'loop the list' },
  { value: 'loop-last', label: 'loop the last track' },
  { value: 'shuffle', label: 'shuffle on' }
]

const CROSSFADE_DEFAULT_MS = 2500
const CROSSFADE_STEP_MS = 500
const CROSSFADE_MAX_MS = 20000

function TrackRow({
  index,
  draft,
  title,
  missing
}: {
  index: number
  draft: SceneDraft
  title: string
  missing: boolean
}): JSX.Element {
  const builderKey = useStore((s) => s.builderKey)!
  const editDraft = useStore((s) => s.editDraft)
  const id = draftSongId(index, draft.songIds[index])
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const isStart = index === draft.currentIndex

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`row draft-track ${isStart ? 'start-track' : ''} ${missing ? 'missing' : ''}`}
    >
      <span className="draft-track-num">{index + 1}</span>
      <span className="grip" {...attributes} {...listeners} title="Drag to reorder" aria-label="Drag to reorder">
        <Icon name="grip" size={16} />
      </span>
      <div className="title">
        <span className="song-title">{title}</span>
        {missing && <span className="sub">no longer in your library</span>}
      </div>
      <button
        className={`draft-start-btn ${isStart ? 'on' : ''}`}
        title={isStart ? 'The scene starts on this track' : 'Start the scene on this track'}
        aria-label={`Start scene on ${title}`}
        aria-pressed={isStart}
        onClick={() => editDraft(builderKey, { type: 'set-start-index', index })}
      >
        {isStart ? 'plays first' : 'play first'}
      </button>
      <button
        className="remove-btn"
        title="Remove from scene"
        aria-label={`Remove ${title} from scene`}
        onClick={() => editDraft(builderKey, { type: 'remove-song', index })}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  )
}

/** The draft's editable track list + list-behavior controls (all via reduceDraft). */
export function DraftMusicList({ draft }: { draft: SceneDraft }): JSX.Element {
  const builderKey = useStore((s) => s.builderKey)!
  const editDraft = useStore((s) => s.editDraft)
  const songs = useStore((s) => s.library.songs)
  const { setNodeRef, isOver } = useDroppable({ id: DRAFT_MUSIC_DROP })

  const crossfade = draft.crossfadeMs ?? CROSSFADE_DEFAULT_MS
  const setCrossfade = (ms: number): void =>
    editDraft(builderKey, {
      type: 'set-crossfade',
      crossfadeMs: Math.max(0, Math.min(CROSSFADE_MAX_MS, ms))
    })

  return (
    <div ref={setNodeRef} className={`draft-music ${isOver ? 'drop-target' : ''}`}>
      {draft.songIds.length > 0 && (
        <SortableContext
          items={draft.songIds.map((sid, i) => draftSongId(i, sid))}
          strategy={verticalListSortingStrategy}
        >
          {draft.songIds.map((sid, i) => {
            const song = songs.find((s) => s.id === sid)
            return (
              <TrackRow
                key={draftSongId(i, sid)}
                index={i}
                draft={draft}
                title={song?.title ?? 'Missing item'}
                missing={!song}
              />
            )
          })}
        </SortableContext>
      )}

      {/* Pill row (mockup parity): list-end select + crossfade stepper, inline. */}
      <div className="draft-pill-row">
        <label className="draft-pill">
          when the list ends:
          <select
            value={draft.endOfList ?? ''}
            aria-label="What happens when the track list ends"
            onChange={(e) =>
              editDraft(builderKey, {
                type: 'set-end-of-list',
                ...(e.target.value ? { policy: e.target.value as EndOfListPolicy } : {})
              })
            }
          >
            <option value="">follow the player’s repeat mode</option>
            {END_OF_LIST_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="draft-pill" title={draft.crossfadeMs === undefined ? 'Default crossfade' : undefined}>
          crossfade
          <button
            className="icon"
            title="Shorter crossfade"
            aria-label="Shorter crossfade"
            disabled={crossfade <= 0}
            onClick={() => setCrossfade(crossfade - CROSSFADE_STEP_MS)}
          >
            −
          </button>
          <b>{(crossfade / 1000).toFixed(1)}</b>
          <button
            className="icon"
            title="Longer crossfade"
            aria-label="Longer crossfade"
            disabled={crossfade >= CROSSFADE_MAX_MS}
            onClick={() => setCrossfade(crossfade + CROSSFADE_STEP_MS)}
          >
            +
          </button>
          s
        </span>
        <label className="draft-pill draft-pill-volume">
          volume · {Math.round(draft.musicVolume * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={draft.musicVolume}
            aria-label="Scene music volume"
            onChange={(e) =>
              editDraft(builderKey, { type: 'set-music-volume', volume: Number(e.target.value) })
            }
          />
        </label>
      </div>

      <div className="doc-drop-hint">
        drop a track here — or press {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}K to add
        one without leaving this screen
      </div>
    </div>
  )
}
