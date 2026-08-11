import { useStore } from '../store'
import { Icon } from './Icon'
import { DraftMusicList } from './DraftMusicList'
import { DraftAmbienceLayer } from './DraftAmbienceLayer'
import { DraftPadGrid } from './DraftPadGrid'

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

  if (!builderKey || !draft) {
    // Defensive: a stale workspace with no draft falls back visually to nothing;
    // WorkspaceHost only routes here while builderKey is set.
    return null
  }

  const isNew = draft.sceneId === undefined

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
          <div className="muted small">
            No ambience layers — drag sounds here from the library palette.
          </div>
        ) : (
          <div className="draft-layers">
            {draft.ambience.map((l, i) => (
              <DraftAmbienceLayer key={`${l.songId}:${i}`} layer={l} index={i} />
            ))}
          </div>
        )}

        <div className="section-label">
          <Icon name="sparkle" size={13} /> Sound pads · {draft.pads.length}
        </div>
        <DraftPadGrid pads={draft.pads} />

        <label className="builder-field builder-note">
          <span className="builder-label">GM note — only you see this</span>
          <textarea
            rows={3}
            placeholder="Cues, reminders, table notes…"
            value={draft.note ?? ''}
            onChange={(e) => editDraft(builderKey, { type: 'set-note', note: e.target.value })}
          />
        </label>
      </div>
    </div>
  )
}
