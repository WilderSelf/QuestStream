import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useStore } from '../store'
import { draftToPreviewRequest } from '@shared/scene-preview'
import { isDirty } from '@shared/scene-edit'
import type { Song } from '@shared/types'
import { Icon } from './Icon'
import { DraftMusicList } from './DraftMusicList'
import { DraftAmbienceLayer } from './DraftAmbienceLayer'
import { DraftPadGrid } from './DraftPadGrid'
import { LibraryPalette } from './LibraryPalette'

export const DRAFT_AMBIENCE_DROP = 'draft-ambience-drop'
export const DRAFT_PADS_DROP = 'draft-pads-drop'

/**
 * The scene builder workspace (grimoire Phase 4): edits a SceneDraft document.
 * Structurally safe by construction — everything here goes through the drafts
 * slice and the preview bus; nothing touches the live mix (the live player and
 * ambience IPC namespaces are banned in the builder by the isolation test).
 */
export function SceneBuilder(): JSX.Element | null {
  const builderKey = useStore((s) => s.builderKey)
  const draft = useStore((s) => (s.builderKey ? s.sceneDrafts[s.builderKey] : undefined))
  const editDraft = useStore((s) => s.editDraft)
  const saveDraft = useStore((s) => s.saveDraft)
  const discardDraft = useStore((s) => s.discardDraft)
  const closeBuilder = useStore((s) => s.closeBuilder)
  const startPreview = useStore((s) => s.startPreview)
  const stopPreview = useStore((s) => s.stopPreview)
  const previewing = useStore((s) => s.previewStatus?.playing ?? false)
  const showNotice = useStore((s) => s.showNotice)
  const songs = useStore((s) => s.library.songs)
  const songsById = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs])
  const liveSceneName = useStore((s) =>
    s.loadedSceneId ? s.library.scenes.find((sc) => sc.id === s.loadedSceneId)?.name : undefined
  )
  const anythingPlaying = useStore((s) => s.currentUid !== null || s.ambience.length > 0)
  const liveCaption = liveSceneName
    ? `“${liveSceneName}” keeps playing for the table while you build this.`
    : anythingPlaying
      ? 'The current mix keeps playing for the table while you build this.'
      : 'Nothing is playing for the table right now.'

  const ambienceDrop = useDroppable({ id: DRAFT_AMBIENCE_DROP })
  const padsDrop = useDroppable({ id: DRAFT_PADS_DROP })

  if (!builderKey || !draft) {
    // Defensive: a stale workspace with no draft falls back visually to nothing;
    // WorkspaceHost only routes here while builderKey is set.
    return null
  }

  const isNew = draft.sceneId === undefined
  const savedScene = draft.sceneId
    ? useStore.getState().library.scenes.find((sc) => sc.id === draft.sceneId)
    : undefined
  const dirty = isDirty(draft, savedScene)

  /** Palette activation adds to the draft by kind — never to the live mix. */
  function addFromPalette(song: Song): void {
    if (!builderKey) return
    if (song.kind === 'ambience') editDraft(builderKey, { type: 'add-layer', songId: song.id })
    else if (song.kind === 'sfx') editDraft(builderKey, { type: 'add-pad', pad: { songId: song.id } })
    else editDraft(builderKey, { type: 'add-song', songId: song.id })
  }

  function copyLiveMix(): void {
    if (builderKey) useStore.getState().copyLiveMixToDraft(builderKey)
  }

  function togglePreview(): void {
    if (!builderKey || !draft) return
    if (previewing) {
      void stopPreview()
      return
    }
    const request = draftToPreviewRequest(draft, songsById)
    if (request.layers.length === 0) {
      showNotice('Nothing to preview yet — add a track or a layer first.', 'info')
      return
    }
    void startPreview(request)
  }

  async function save(): Promise<void> {
    if (!builderKey) return
    await stopPreview()
    await saveDraft(builderKey)
    showNotice('Scene saved', 'info')
    closeBuilder()
  }

  function discard(): void {
    if (!builderKey) return
    if (!confirm('Discard this draft? Your edits will be lost.')) return
    discardDraft(builderKey)
    closeBuilder()
  }

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
        </span>
        <span className="header-actions builder-actions">
          {previewing && (
            <span className="preview-badge">
              <Icon name="headphones" size={13} /> Only you hear this
            </span>
          )}
          <button className="btn" title="Discard this draft" onClick={discard}>
            Discard
          </button>
        </span>
      </div>
      <div className="builder-columns">
        <LibraryPalette onAdd={addFromPalette} />
        <div className="pane-body builder-body">
          <div className="builder-doc">
            <div className="doc-eyebrow">
              {isNew ? 'new scene · unsaved' : dirty ? 'edit scene · unsaved changes' : 'edit scene'}
            </div>
            <input
              className="builder-name"
              type="text"
              placeholder="Untitled Scene"
              aria-label="Scene name"
              value={draft.name}
              onChange={(e) => editDraft(builderKey, { type: 'set-name', name: e.target.value })}
            />
            <input
              className="builder-note-line"
              type="text"
              placeholder="click to add a note — shown whenever you open this scene"
              aria-label="GM note — only you see this"
              title="GM note — only you see this"
              value={draft.note ?? ''}
              onChange={(e) => editDraft(builderKey, { type: 'set-note', note: e.target.value })}
            />

            <div className="doc-section-label">Music</div>
            <DraftMusicList draft={draft} />

            <div
              ref={ambienceDrop.setNodeRef}
              className={ambienceDrop.isOver ? 'drop-target' : undefined}
            >
              <div className="doc-section-label">Ambience</div>
              {draft.ambience.length > 0 && (
                <div className="draft-layers">
                  {draft.ambience.map((l, i) => (
                    <DraftAmbienceLayer key={`${l.songId}:${i}`} layer={l} index={i} />
                  ))}
                </div>
              )}
              <div className="doc-drop-hint">
                drop ambience — its volume and timing are saved with the scene
              </div>
            </div>

            <div ref={padsDrop.setNodeRef} className={padsDrop.isOver ? 'drop-target' : undefined}>
              <div className="doc-section-label">Soundboard</div>
              <DraftPadGrid pads={draft.pads} />
            </div>

            <div className="doc-actions">
              <button
                className="btn"
                title="Replace this draft's contents with what's playing right now"
                onClick={copyLiveMix}
              >
                <Icon name="download" size={14} /> Copy current mix into this scene
              </button>
              <button
                className={`btn ${previewing ? 'active' : ''}`}
                title="Listen to this scene yourself — the table keeps hearing the live mix"
                aria-pressed={previewing}
                onClick={togglePreview}
              >
                <Icon name={previewing ? 'pause' : 'headphones'} size={14} />{' '}
                {previewing ? 'Stop preview' : 'Preview — only you hear it'}
              </button>
              <button className="btn primary" title="Save this scene" onClick={() => void save()}>
                <Icon name="save" size={14} /> Save scene
              </button>
            </div>
            <div className="doc-caption">
              {liveCaption} Nothing changes until you press Play scene.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
