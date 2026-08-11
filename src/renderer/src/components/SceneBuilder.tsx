import { useStore } from '../store'
import { Icon } from './Icon'
import { DraftMusicList } from './DraftMusicList'

/**
 * The scene builder workspace (grimoire Phase 4): edits a SceneDraft document.
 * Structurally safe by construction — everything here goes through the drafts
 * slice and the preview bus; nothing touches the live mix (window.api.player /
 * window.api.ambience are banned in SceneBuilder* by the isolation test).
 */
export function SceneBuilder(): JSX.Element | null {
  const builderKey = useStore((s) => s.builderKey)
  const draft = useStore((s) => (s.builderKey ? s.sceneDrafts[s.builderKey] : undefined))
  const editDraft = useStore((s) => s.editDraft)
  const closeBuilder = useStore((s) => s.closeBuilder)
  const songs = useStore((s) => s.library.songs)

  if (!builderKey || !draft) {
    // Defensive: a stale workspace with no draft falls back visually to nothing;
    // WorkspaceHost only routes here while builderKey is set.
    return null
  }

  const isNew = draft.sceneId === undefined
  const titleFor = (id: string): string => songs.find((s) => s.id === id)?.title ?? 'Missing item'

  return (
    <div className="pane builder-pane">
      <div className="pane-header builder-header">
        <span className="pane-title">
          <button
            className="icon"
            title="Back to library"
            aria-label="Back to library"
            onClick={closeBuilder}
          >
            <Icon name="chevron-right" size={16} className="flip" />
          </button>
          <Icon name="bookmark" size={15} />
          {isNew ? 'New scene' : 'Edit scene'}
          <span className="builder-draft-badge">draft</span>
        </span>
      </div>
      <div className="pane-body builder-body">
        <label className="builder-field">
          <span className="builder-label">Name</span>
          <input
            className="builder-name"
            type="text"
            placeholder="Untitled Scene"
            value={draft.name}
            onChange={(e) => editDraft(builderKey, { type: 'set-name', name: e.target.value })}
          />
        </label>

        <div className="section-label">
          <Icon name="music" size={13} /> Music · {draft.songIds.length}
        </div>
        <DraftMusicList draft={draft} />

        <div className="section-label">
          <Icon name="layers" size={13} /> Ambience · {draft.ambience.length}
        </div>
        {draft.ambience.length === 0 ? (
          <div className="muted small">No ambience layers.</div>
        ) : (
          <ul className="builder-track-list">
            {draft.ambience.map((l, i) => (
              <li key={`${l.songId}:${i}`}>
                {titleFor(l.songId)} · {l.mode === 'random' ? 'random' : 'loop'} ·{' '}
                {Math.round(l.volume * 100)}%
              </li>
            ))}
          </ul>
        )}

        <div className="section-label">
          <Icon name="sparkle" size={13} /> Sound pads · {draft.pads.length}
        </div>
        {draft.pads.length === 0 && <div className="muted small">No pads for this scene.</div>}
      </div>
    </div>
  )
}
