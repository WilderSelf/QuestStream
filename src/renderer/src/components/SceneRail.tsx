import type { KeyboardEvent } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

/** Enter/Space activation for clickable non-button rows (same helper as Browser rows). */
function rowActivation(onActivate: () => void): {
  role: 'button'
  tabIndex: 0
  onClick: () => void
  onKeyDown: (e: KeyboardEvent) => void
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onActivate()
      }
    }
  }
}

/**
 * The grimoire scene rail: scenes as notched bookmark cards (F1–F8 recall the first
 * eight), the Playlists list beneath, and pack import. Replaces the old PlaylistsPane.
 * Clicking a bookmark recalls the scene (same dirty-mix confirm as before — the guard
 * retires when scenes get an explicit Play action in Phase 5).
 */
export function SceneRail(): JSX.Element {
  const playlists = useStore((s) => s.library.playlists)
  const scenes = useStore((s) => s.library.scenes)
  const loadPlaylist = useStore((s) => s.loadPlaylist)
  const recallScene = useStore((s) => s.recallScene)
  const loadedId = useStore((s) => s.loadedPlaylistId)
  const loadedSceneId = useStore((s) => s.loadedSceneId)
  const queue = useStore((s) => s.queue)
  const ambience = useStore((s) => s.ambience)
  const showNotice = useStore((s) => s.showNotice)
  const collapsed = useStore((s) => s.playlistsCollapsed)
  const toggleCollapsed = useStore((s) => s.togglePlaylistsCollapsed)
  const railWidth = useStore((s) => s.railWidth)
  const setSaveScenePromptOpen = useStore((s) => s.setSaveScenePromptOpen)

  function recallSceneConfirmed(id: string): void {
    const dirty = queue.length > 0 || ambience.length > 0
    if (
      !dirty ||
      loadedSceneId === id ||
      confirm('Replace the current mix with this scene? Unsaved changes will be lost.')
    )
      recallScene(id)
  }

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

  if (collapsed) {
    return (
      <div className="pane scenes-pane collapsed">
        <button
          className="icon rail-expand"
          title="Show Scenes &amp; Playlists"
          aria-label="Show Scenes and Playlists"
          onClick={toggleCollapsed}
        >
          <Icon name="chevron-right" size={16} />
        </button>
        <div className="rail-glyphs" aria-hidden="true">
          <Icon name="bookmark" size={16} />
          <Icon name="music" size={16} />
        </div>
      </div>
    )
  }

  return (
    <div className="pane scenes-pane scene-rail" style={{ width: railWidth }}>
      <div className="pane-header">
        <span className="pane-title">
          <button
            className="icon"
            title="Collapse panel"
            aria-label="Collapse Scenes and Playlists"
            onClick={toggleCollapsed}
          >
            <Icon name="chevron-right" size={16} className="flip" />
          </button>
          Scenes
        </span>
        <span className="header-actions">
          <button
            className="icon"
            title="Import a shared pack (.questpack)"
            aria-label="Import a shared pack"
            onClick={() => void importPack()}
          >
            <Icon name="download" size={16} />
          </button>
        </span>
      </div>
      <div className="pane-body">
        <div className="rail-caption">One click restores the whole mix — music, layers, and volumes.</div>
        {scenes.length === 0 && (
          <div className="muted small">
            Build a mix (queue + ambience), then “Save as scene” to bookmark it here.
          </div>
        )}
        {scenes.map((sc, i) => (
          <div
            key={sc.id}
            className={`bookmark ${loadedSceneId === sc.id ? 'on-air' : ''}`}
            title="Play this scene (crossfades)"
            {...rowActivation(() => recallSceneConfirmed(sc.id))}
          >
            {loadedSceneId === sc.id && <span className="bookmark-ribbon" aria-hidden="true" />}
            <div className="bookmark-name">{sc.name}</div>
            <div className="bookmark-meta">
              {loadedSceneId === sc.id ? 'playing · ' : ''}
              {sc.songIds.length} tracks · {sc.ambience.length} layers
            </div>
            {i < 8 && (
              <span className="bookmark-key" aria-hidden="true">
                F{i + 1}
              </span>
            )}
            <span className="bookmark-actions">
              <button
                className="remove-btn"
                title="Export pack"
                aria-label={`Export scene ${sc.name}`}
                onClick={(e) => void exportScene(sc.id, e)}
              >
                <Icon name="upload" size={14} />
              </button>
              <button
                className="remove-btn"
                title="Delete"
                aria-label={`Delete scene ${sc.name}`}
                onClick={(e) => void removeScene(sc.id, e)}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        ))}
        <button
          className="bookmark-add"
          title="Save the current mix as a new scene"
          onClick={() => setSaveScenePromptOpen(true)}
        >
          <Icon name="plus" size={14} /> New scene
        </button>

        <div className="section-label">
          <Icon name="music" size={13} /> Playlists
        </div>
        <div className="section-caption">Just an ordered list of tracks.</div>
        {playlists.length === 0 && (
          <div className="muted small">Build a queue, then “Save as playlist”.</div>
        )}
        {playlists.map((p) => (
          <div
            key={p.id}
            className={`row playlist-row ${loadedId === p.id ? 'selected' : ''}`}
            {...rowActivation(() => loadPlaylist(p.id))}
          >
            <div className="title">
              <div className="title">{p.name}</div>
              <div className="sub">{p.songIds.length} tracks</div>
            </div>
            <button
              className="remove-btn"
              title="Export pack"
              aria-label={`Export playlist ${p.name}`}
              onClick={(e) => void exportPlaylist(p.id, e)}
            >
              <Icon name="upload" size={15} />
            </button>
            <button
              className="remove-btn"
              title="Delete"
              aria-label={`Delete playlist ${p.name}`}
              onClick={(e) => void removePlaylist(p.id, e)}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
