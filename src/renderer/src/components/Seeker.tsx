import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, fmtTime } from '../store'
import { rankSeeker, type SeekerHit } from '@shared/search-rank'
import { KIND_LABELS } from '@shared/taxonomy'
import { Icon } from './Icon'

const GROUP_TITLES: Record<SeekerHit['group'], string> = {
  scene: 'In this scene',
  scenes: 'Scenes',
  library: 'Library',
  actions: 'Actions'
}

/**
 * The ⌘K seeker (grimoire Phase 8): one input that finds tracks, scenes, and
 * actions from anywhere. Selection acts contextually — a track plays (or joins
 * the open draft), a scene opens its page, an action just runs.
 */
export function Seeker(): JSX.Element | null {
  const open = useStore((s) => s.seekerOpen)
  const setOpen = useStore((s) => s.setSeekerOpen)
  const songs = useStore((s) => s.library.songs)
  const scenes = useStore((s) => s.library.scenes)
  const openSceneId = useStore((s) => s.scenePageId ?? s.loadedSceneId)
  const builderKey = useStore((s) => s.builderKey)

  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      // Focus after the overlay paints.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const actions = useMemo(
    () => [
      { id: 'new-scene', label: 'New scene', aliases: ['build', 'create'] },
      { id: 'import', label: 'Import audio', aliases: ['add', 'workbench'] },
      { id: 'library', label: 'Go to library', aliases: ['browse', 'home'] },
      { id: 'duck', label: 'Duck the mix (tap again to release)', aliases: ['quiet', 'lower'] }
    ],
    []
  )

  const sceneScopeSongIds = useMemo(() => {
    const sc = openSceneId ? scenes.find((s) => s.id === openSceneId) : undefined
    return sc?.songIds ?? []
  }, [openSceneId, scenes])

  const hits = useMemo(
    () => rankSeeker(query, { songs, scenes, sceneScopeSongIds, actions }),
    [query, songs, scenes, sceneScopeSongIds, actions]
  )

  useEffect(() => setSel(0), [query])

  if (!open) return null

  function activate(hit: SeekerHit | undefined): void {
    if (!hit) return
    const st = useStore.getState()
    switch (hit.group) {
      case 'scene': {
        // Play the open scene, starting on this track (missing songs skew the
        // recall queue, so map to the filtered index).
        const sc = scenes.find((s) => s.id === openSceneId)
        if (!sc) break
        const present = sc.songIds.filter((id) => songs.some((s) => s.id === id))
        const at = present.indexOf(hit.id)
        st.playScene(sc.id, at >= 0 ? { startIndex: at } : {})
        break
      }
      case 'scenes':
        st.openScenePage(hit.id)
        break
      case 'library': {
        const song = songs.find((s) => s.id === hit.id)
        if (!song) break
        if (builderKey) {
          // Builder open → the seeker feeds the DRAFT, not the live mix.
          if (song.kind === 'ambience') st.editDraft(builderKey, { type: 'add-layer', songId: song.id })
          else if (song.kind === 'sfx')
            st.editDraft(builderKey, { type: 'add-pad', pad: { songId: song.id } })
          else st.editDraft(builderKey, { type: 'add-song', songId: song.id })
          st.showNotice(`Added “${song.title}” to the draft`, 'info')
        } else {
          st.enqueueSongs([song])
          st.showNotice(`Queued “${song.title}”`, 'info')
        }
        break
      }
      case 'actions':
        if (hit.id === 'new-scene') st.openBuilder()
        else if (hit.id === 'import') st.setWorkspace('import')
        else if (hit.id === 'library') st.setWorkspace('library')
        else if (hit.id === 'duck') st.setDuck(!st.ducking)
        break
    }
    setOpen(false)
  }

  return (
    <div className="seeker-backdrop" onClick={() => setOpen(false)}>
      <div
        className="seeker"
        role="dialog"
        aria-modal="true"
        aria-label="Find anything"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="seeker-input-row">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Find a track, scene, or action…"
            aria-label="Find a track, scene, or action"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((i) => Math.min(hits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                activate(hits[sel])
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        {query.trim() === '' ? (
          <div className="seeker-hint muted small">
            Type to search everything. <kbd>↑↓</kbd> choose · <kbd>Enter</kbd> go —
            tracks play (or join an open draft), scenes open, actions run.
          </div>
        ) : hits.length === 0 ? (
          <div className="seeker-hint muted small">Nothing matches.</div>
        ) : (
          <div className="seeker-results" role="listbox">
            {hits.map((h, i) => {
              const song =
                h.group === 'scene' || h.group === 'library'
                  ? songs.find((s) => s.id === h.id)
                  : undefined
              const detail = song
                ? ` — ${KIND_LABELS[song.kind ?? 'track'].toLowerCase()}, ${fmtTime(song.duration)}`
                : ''
              // The right-hand hint names what Enter will DO, mockup-style.
              const action =
                h.group === 'scene'
                  ? 'play from here'
                  : h.group === 'scenes'
                    ? 'open'
                    : h.group === 'library'
                      ? builderKey
                        ? 'add to draft'
                        : 'queue'
                      : 'run'
              return (
                <div key={`${h.group}:${h.id}`}>
                  {(i === 0 || hits[i - 1].group !== h.group) && (
                    <div className="seeker-group">{GROUP_TITLES[h.group]}</div>
                  )}
                  <button
                    className={`seeker-hit ${i === sel ? 'selected' : ''}`}
                    role="option"
                    aria-selected={i === sel}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => activate(h)}
                  >
                    <span className="seeker-hit-label">
                      {h.label}
                      {detail && <span className="seeker-hit-detail">{detail}</span>}
                    </span>
                    <span className="seeker-hit-sub">{action}</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="seeker-footer">
          <span>
            <kbd>↑↓</kbd> move · <kbd>Enter</kbd> go · <kbd>Esc</kbd> close
          </span>
          <span>searches track and scene titles</span>
        </div>
      </div>
    </div>
  )
}
