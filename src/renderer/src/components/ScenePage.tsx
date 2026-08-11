import { useMemo, useState } from 'react'
import { useStore, fmtTime } from '../store'
import { Icon } from './Icon'

/** "Last played" copy: honest, coarse, plain language. */
export function fmtLastPlayed(at: number | undefined, now = Date.now()): string {
  if (!at) return 'Never played'
  const days = Math.floor((now - at) / 86_400_000)
  if (days <= 0) return 'Played today'
  if (days === 1) return 'Played yesterday'
  if (days < 30) return `Played ${days} days ago`
  return `Played ${new Date(at).toLocaleDateString()}`
}

/**
 * The open-scene page (grimoire Phase 5): rail click lands here with NO audio
 * side effects — reading a scene never touches the live mix. Play/Preview
 * controls join in the next commit.
 */
export function ScenePage(): JSX.Element | null {
  const sceneId = useStore((s) => s.scenePageId)
  const scene = useStore((s) => s.library.scenes.find((sc) => sc.id === s.scenePageId))
  const songs = useStore((s) => s.library.songs)
  const loadedSceneId = useStore((s) => s.loadedSceneId)
  const closeScenePage = useStore((s) => s.closeScenePage)
  const openBuilder = useStore((s) => s.openBuilder)
  const [filter, setFilter] = useState('')

  const songsById = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs])

  if (!sceneId || !scene) return null
  const onAir = loadedSceneId === scene.id

  const q = filter.trim().toLowerCase()
  const rows = scene.songIds.map((id, i) => ({ index: i, song: songsById.get(id) }))
  const visible = q
    ? rows.filter((r) => (r.song?.title ?? 'missing item').toLowerCase().includes(q))
    : rows

  return (
    <div className="pane scene-page">
      <div className="pane-header scene-page-header">
        <span className="pane-title">
          <button
            className="icon"
            title="Back to library"
            aria-label="Back to library"
            onClick={closeScenePage}
          >
            <Icon name="chevron-right" size={16} className="flip" />
          </button>
          <Icon name="bookmark" size={15} />
          Scene
          {onAir && <span className="on-air-chip">on air</span>}
        </span>
        <span className="header-actions">
          <button
            className="btn"
            title="Edit this scene"
            onClick={() => openBuilder(scene.id)}
          >
            <Icon name="edit" size={14} /> Edit
          </button>
        </span>
      </div>
      <div className="pane-body scene-page-body">
        <h1 className="scene-page-name">{scene.name}</h1>
        <div className="scene-page-meta">
          {fmtLastPlayed(scene.lastPlayedAt)} · {scene.songIds.length} tracks ·{' '}
          {scene.ambience.length} layers
          {(scene.pads?.length ?? 0) > 0 && <> · {scene.pads!.length} pads</>}
        </div>
        {scene.note && <p className="scene-page-note">{scene.note}</p>}

        <div className="scene-page-toolbar">
          <div className="palette-search scene-page-filter">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Find in this scene…"
              value={filter}
              aria-label="Find a track in this scene"
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>

        <div className="section-label">
          <Icon name="music" size={13} /> Music · {scene.songIds.length}
        </div>
        {visible.length === 0 && (
          <div className="muted small">
            {q ? 'No tracks match.' : 'This scene has no tracks.'}
          </div>
        )}
        {visible.map(({ index, song }) => (
          <div key={`${index}`} className={`row scene-page-track ${song ? '' : 'missing'}`}>
            <span className="draft-track-num">{index + 1}</span>
            <div className="title">
              <span className="song-title">{song?.title ?? 'Missing item'}</span>
            </div>
            {index === scene.currentIndex && (
              <span className="builder-start-mark">starts here</span>
            )}
            {song && <span className="sub">{fmtTime(song.duration)}</span>}
          </div>
        ))}

        {scene.ambience.length > 0 && (
          <>
            <div className="section-label">
              <Icon name="layers" size={13} /> Ambience · {scene.ambience.length}
            </div>
            {scene.ambience.map((a, i) => {
              const layerSongs = (a.pool ?? [a.songId])
                .map((id) => songsById.get(id)?.title ?? 'Missing item')
                .join(', ')
              return (
                <div key={i} className="row scene-page-track">
                  <span className="draft-track-num" aria-hidden="true">
                    ~
                  </span>
                  <div className="title">
                    <span className="song-title">{layerSongs}</span>
                  </div>
                  <span className="sub">
                    {(a.mode ?? 'loop') === 'random' ? 'random' : 'loop'} ·{' '}
                    {Math.round(a.volume * 100)}%
                  </span>
                </div>
              )
            })}
          </>
        )}

        {(scene.pads?.length ?? 0) > 0 && (
          <>
            <div className="section-label">
              <Icon name="sparkle" size={13} /> Sound pads · {scene.pads!.length}
            </div>
            <div className="scene-page-pads">
              {scene.pads!.map((p, i) => (
                <span key={i} className="scene-page-pad">
                  {songsById.get(p.songId)?.title ?? 'Missing item'}
                  {p.hotkey && <kbd>{p.hotkey}</kbd>}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
