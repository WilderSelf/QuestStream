import { useMemo, useState } from 'react'
import { useStore, fmtTime } from '../store'
import { newDraft } from '@shared/scene-edit'
import { draftToPreviewRequest } from '@shared/scene-preview'
import { DEFAULT_CROSSFADE_MS } from '@shared/num'
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
  const playScene = useStore((s) => s.playScene)
  const startPreview = useStore((s) => s.startPreview)
  const stopPreview = useStore((s) => s.stopPreview)
  const previewing = useStore((s) => s.previewStatus?.playing ?? false)
  const showNotice = useStore((s) => s.showNotice)
  const currentUid = useStore((s) => s.currentUid)
  const currentTitle = useStore((s) => s.queue.find((q) => q.uid === s.currentUid)?.song.title)
  const [filter, setFilter] = useState('')
  const [includeMusic, setIncludeMusic] = useState(true)
  const [includeAmbience, setIncludeAmbience] = useState(true)

  const songsById = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs])
  const songsRecord = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs])

  if (!sceneId || !scene) return null
  const onAir = loadedSceneId === scene.id

  const crossfadeSec = ((scene.crossfadeMs ?? DEFAULT_CROSSFADE_MS) / 1000).toFixed(1)
  const transitionCaption = !includeMusic
    ? 'Music keeps playing — only the selected parts change.'
    : currentUid && currentTitle
      ? `Crossfades from “${currentTitle}” over ${crossfadeSec} s.`
      : `Fades in over ${crossfadeSec} s.`

  function togglePreview(): void {
    if (previewing) {
      void stopPreview()
      return
    }
    if (!scene) return
    const request = draftToPreviewRequest(newDraft(scene), songsRecord)
    if (request.layers.length === 0) {
      showNotice('Nothing to preview — this scene has no playable items.', 'info')
      return
    }
    void startPreview(request)
  }

  function play(startIndex?: number): void {
    if (!scene) return
    void stopPreview()
    playScene(scene.id, {
      includeMusic: startIndex !== undefined ? true : includeMusic,
      includeAmbience,
      ...(startIndex !== undefined ? { startIndex } : {})
    })
  }

  const q = filter.trim().toLowerCase()
  const rows = scene.songIds.map((id, i) => ({ index: i, song: songsById.get(id) }))
  const visible = q
    ? rows.filter((r) => (r.song?.title ?? 'missing item').toLowerCase().includes(q))
    : rows
  // "Start scene here" needs the row's index in the FILTERED queue the recall
  // plan builds (missing songs are dropped there), not its raw scene index.
  const filteredIndexByRaw = new Map<number, number>()
  let fi = 0
  for (const r of rows) if (r.song) filteredIndexByRaw.set(r.index, fi++)

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
          {previewing && (
            <span className="preview-badge">
              <Icon name="headphones" size={13} /> Only you hear this
            </span>
          )}
          <button
            className={`btn ${previewing ? 'active' : ''}`}
            title="Listen to this scene yourself — the table keeps hearing the live mix"
            aria-pressed={previewing}
            onClick={togglePreview}
          >
            <Icon name={previewing ? 'pause' : 'headphones'} size={14} />{' '}
            {previewing ? 'Stop preview' : 'Preview'}
          </button>
          <button
            className="btn primary"
            title="Play this scene for the table"
            disabled={!includeMusic && !includeAmbience}
            onClick={() => play()}
          >
            <Icon name="play" size={14} /> Play scene
          </button>
          <label className="scene-page-toggle">
            <input
              type="checkbox"
              checked={includeMusic}
              onChange={(e) => setIncludeMusic(e.target.checked)}
            />
            Music
          </label>
          <label className="scene-page-toggle">
            <input
              type="checkbox"
              checked={includeAmbience}
              onChange={(e) => setIncludeAmbience(e.target.checked)}
            />
            Ambience
          </label>
        </div>
        <div className="scene-page-transition">{transitionCaption}</div>

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
            {song && (
              <button
                className="draft-start-btn scene-page-start"
                title="Play the scene, starting on this track"
                aria-label={`Play the scene starting on ${song.title}`}
                onClick={() => play(filteredIndexByRaw.get(index))}
              >
                <Icon name="play" size={12} /> start here
              </button>
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
