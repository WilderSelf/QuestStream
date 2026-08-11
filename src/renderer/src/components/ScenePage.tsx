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
  const [keepVolumes, setKeepVolumes] = useState(false)
  const [listenIdx, setListenIdx] = useState<number | null>(null)

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
    setListenIdx(null)
    playScene(scene.id, {
      includeMusic: startIndex !== undefined ? true : includeMusic,
      includeAmbience,
      ...(keepVolumes ? { keepVolumes: true } : {}),
      ...(startIndex !== undefined ? { startIndex } : {})
    })
  }

  /** GM-only audition of one track (the row's circled play). */
  function listenRow(index: number, song: { id: string } | undefined): void {
    if (!song) return
    if (previewing && listenIdx === index) {
      void stopPreview()
      setListenIdx(null)
      return
    }
    const full = songsById.get(song.id)
    if (!full) return
    setListenIdx(index)
    void startPreview({ layers: [{ song: full, volume: 1, loop: false }] })
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

  const plurUp = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  const presentSongs = rows.filter((r) => r.song)
  const totalSec = presentSongs.reduce((sum, r) => sum + (r.song?.duration ?? 0), 0)
  const endOfListLabel =
    scene.endOfList === 'stop'
      ? 'stop'
      : scene.endOfList === 'loop-list'
        ? 'loop the list'
        : scene.endOfList === 'loop-last'
          ? 'loop the last track'
          : scene.endOfList === 'shuffle'
            ? 'shuffle on'
            : 'follow the player’s repeat mode'

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
        <div className="builder-doc scene-doc">
          <div className="doc-eyebrow">scene</div>
          <h1 className="scene-page-name">{scene.name}</h1>
          {scene.note && <p className="doc-note">“{scene.note}”</p>}
          <div className="scene-page-meta">{fmtLastPlayed(scene.lastPlayedAt)}</div>

          <div className="palette-search scene-page-filter">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="Search this scene…"
              value={filter}
              aria-label="Find a track in this scene"
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="doc-section-label">
            Music · {plurUp(presentSongs.length, 'track')} · {fmtTime(totalSec)}
          </div>
          {visible.length === 0 && (
            <div className="muted small doc-empty">
              {q ? 'No tracks match.' : 'This scene has no tracks.'}
            </div>
          )}
          {visible.map(({ index, song }) => (
            <div key={`${index}`} className={`row scene-page-track ${song ? '' : 'missing'}`}>
              <button
                className={`play-btn scene-page-listen ${previewing && listenIdx === index ? 'active' : ''}`}
                title="Listen to this track — only you hear it"
                aria-label={`Listen to ${song?.title ?? 'missing item'} (only you hear it)`}
                aria-pressed={previewing && listenIdx === index}
                disabled={!song}
                onClick={() => listenRow(index, song)}
              >
                <Icon name={previewing && listenIdx === index ? 'pause' : 'play'} size={14} />
              </button>
              <div className="title">
                <span className="song-title">{song?.title ?? 'Missing item'}</span>
                {index === scene.currentIndex && <div className="sub">plays first</div>}
              </div>
              {song && (
                <button
                  className="draft-start-btn scene-page-start"
                  title="Play the scene for the table, starting on this track"
                  aria-label={`Play the scene starting on ${song.title}`}
                  onClick={() => play(filteredIndexByRaw.get(index))}
                >
                  <Icon name="play" size={12} /> start here
                </button>
              )}
              {song && <span className="sub">{fmtTime(song.duration)}</span>}
            </div>
          ))}
          <div className="draft-pill-row scene-doc-pills">
            <span className="draft-pill">
              when the list ends: <b className="scene-doc-pill-value">{endOfListLabel}</b>
            </span>
            <span className="draft-pill">
              crossfade <b>{crossfadeSec}</b> s
              {scene.crossfadeMs === undefined && <span className="sub">(default)</span>}
            </span>
          </div>

          {scene.ambience.length > 0 && (
            <>
              <div className="doc-section-label">
                Ambience · {plurUp(scene.ambience.length, 'layer')}
              </div>
              {scene.ambience.map((a, i) => {
                const layerSongs = (a.pool ?? [a.songId])
                  .map((id) => songsById.get(id)?.title ?? 'Missing item')
                  .join(', ')
                const random = (a.mode ?? 'loop') === 'random'
                return (
                  <div key={i} className="row scene-page-track">
                    <div className="title">
                      <span className="song-title">{layerSongs}</span>
                      <div className="sub">
                        {random ? 'plays once in a while' : 'plays continuously'}
                        {random &&
                          ` · every ${a.minIntervalSec ?? 20}–${a.maxIntervalSec ?? 60} s`}
                      </div>
                    </div>
                    <span className="sub">{Math.round(a.volume * 100)}%</span>
                  </div>
                )
              })}
            </>
          )}

          {(scene.pads?.length ?? 0) > 0 && (
            <>
              <div className="doc-section-label">Soundboard</div>
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

          <div className="doc-actions">
            {previewing && listenIdx === null && (
              <span className="preview-badge">
                <Icon name="headphones" size={13} /> Only you hear this
              </span>
            )}
            <button
              className={`btn ${previewing && listenIdx === null ? 'active' : ''}`}
              title="Listen to this scene yourself — the table keeps hearing the live mix"
              aria-pressed={previewing && listenIdx === null}
              onClick={() => {
                setListenIdx(null)
                togglePreview()
              }}
            >
              <Icon name={previewing && listenIdx === null ? 'pause' : 'headphones'} size={14} />{' '}
              {previewing && listenIdx === null ? 'Stop preview' : 'Preview — only you hear it'}
            </button>
            <button
              className="btn primary"
              title="Play this scene for the table"
              disabled={!includeMusic && !includeAmbience}
              onClick={() => play()}
            >
              <Icon name="play" size={14} /> Play scene
            </button>
          </div>
          <div className="scene-doc-toggles">
            <label className="scene-page-toggle">
              <input
                type="checkbox"
                checked={includeMusic}
                onChange={(e) => setIncludeMusic(e.target.checked)}
              />
              include music
            </label>
            <label className="scene-page-toggle">
              <input
                type="checkbox"
                checked={includeAmbience}
                onChange={(e) => setIncludeAmbience(e.target.checked)}
              />
              include ambience
            </label>
            <label
              className="scene-page-toggle"
              title="Keep the music fader where it is now instead of the scene's saved level"
            >
              <input
                type="checkbox"
                checked={keepVolumes}
                onChange={(e) => setKeepVolumes(e.target.checked)}
              />
              keep current volume
            </label>
          </div>
          <div className="doc-caption">{transitionCaption}</div>
        </div>
      </div>
    </div>
  )
}
