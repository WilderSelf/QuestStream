import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { ItemKind, Song } from '@shared/types'
import type { ImportRow } from '@shared/import-flow'
import { untaggedInbox } from '@shared/import-flow'
import { KIND_ORDER, KIND_LABELS } from '@shared/taxonomy'
import { Icon } from './Icon'
import { SegmentedControl } from './SegmentedControl'
import { TagPicker } from './TagPicker'

/**
 * GM-only listen toggle for one song, over the preview bus. The engine replaces
 * the mix on start, so switching rows simply swaps what you hear.
 */
function ListenButton({
  song,
  listeningId,
  setListeningId
}: {
  song: Song
  listeningId: string | null
  setListeningId: (id: string | null) => void
}): JSX.Element {
  const startPreview = useStore((s) => s.startPreview)
  const stopPreview = useStore((s) => s.stopPreview)
  const active = listeningId === song.id
  return (
    <button
      className={`btn workbench-listen ${active ? 'active' : ''}`}
      title={active ? 'Stop listening' : 'Listen — only you hear this'}
      aria-pressed={active}
      onClick={() => {
        if (active) {
          void stopPreview()
          setListeningId(null)
        } else {
          void startPreview({ layers: [{ song, volume: 1, loop: false }] })
          setListeningId(song.id)
        }
      }}
    >
      <Icon name={active ? 'pause' : 'headphones'} size={13} /> {active ? 'Stop' : 'Listen'}
    </button>
  )
}

const KIND_GLYPHS: Record<ItemKind, string> = { track: '♫', ambience: '〰', sfx: '⌗' }

function rowStatusText(row: ImportRow): string {
  switch (row.status) {
    case 'resolving':
      return 'Looking up…'
    case 'importing':
      return row.total ? `Importing ${row.completed ?? 0} of ${row.total}…` : 'Importing…'
    case 'done': {
      const n = row.addedSongIds.length
      if (n === 0 && (row.total ?? 0) > 0) return 'Nothing new — all already in your library'
      return n === 1 ? 'Added to your library' : `Added ${n} items to your library`
    }
    case 'duplicate':
      return 'Already in your library'
    case 'error':
      return row.message ?? 'Import failed'
  }
}

function ArrivingRow({
  row,
  listeningId,
  setListeningId
}: {
  row: ImportRow
  listeningId: string | null
  setListeningId: (id: string | null) => void
}): JSX.Element {
  const songs = useStore((s) => s.library.songs)
  const failed = row.status === 'error'
  // A row that resolved to exactly one library song (fresh or duplicate) can be auditioned.
  const soleId =
    row.status === 'duplicate'
      ? row.duplicateOfSongId
      : row.status === 'done' && row.addedSongIds.length === 1
        ? row.addedSongIds[0]
        : undefined
  const soleSong = soleId ? songs.find((s) => s.id === soleId) : undefined
  return (
    <div className={`row workbench-row ${row.status}`}>
      <span className="workbench-row-icon" aria-hidden="true">
        {row.status === 'resolving' || row.status === 'importing' ? (
          <Icon name="download" size={14} />
        ) : failed ? (
          <Icon name="warning" size={14} />
        ) : row.status === 'duplicate' ? (
          <Icon name="info" size={14} />
        ) : (
          <Icon name="save" size={14} />
        )}
      </span>
      <div className="title">
        <span className="song-title">{soleSong?.title ?? row.url}</span>
        <div className={`sub ${failed ? 'workbench-error' : ''}`}>{rowStatusText(row)}</div>
      </div>
      {soleSong && (
        <ListenButton song={soleSong} listeningId={listeningId} setListeningId={setListeningId} />
      )}
      {row.status === 'importing' && row.total ? (
        <progress value={row.completed ?? 0} max={row.total} aria-label="Import progress" />
      ) : null}
    </div>
  )
}

/**
 * The import workbench (grimoire Phase 6): a non-blocking workspace replacing
 * the modal wizard. Paste a link or drop files, keep working — arrivals stream
 * into the table below via the pure reduceImportRows fold.
 */
export function ImportWorkbench(): JSX.Element {
  const setWorkspace = useStore((s) => s.setWorkspace)
  const importRows = useStore((s) => s.importRows)
  const kindTab = useStore((s) => s.kindTab)
  const updateYtdlp = useStore((s) => s.updateYtdlp)
  const updatingYtdlp = useStore((s) => s.updatingYtdlp)
  const showNotice = useStore((s) => s.showNotice)

  const songs = useStore((s) => s.library.songs)
  const startTriage = useStore((s) => s.startTriage)
  const previewing = useStore((s) => s.previewStatus?.playing ?? false)

  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<ItemKind>(kindTab)
  const [tags, setTags] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [listeningId, setListeningId] = useState<string | null>(null)
  const dragDepth = useRef(0)

  // A preview that ended on its own (track finished, or another surface took the
  // bus) clears the local listen marker so no button lies about what's audible.
  useEffect(() => {
    if (!previewing && listeningId) setListeningId(null)
  }, [previewing, listeningId])

  const opts = { kind, tags }
  const inbox = untaggedInbox(songs)
  // Everything this workbench session actually created (duplicates excluded).
  const sessionAddedIds = [...new Set(importRows.flatMap((r) => r.addedSongIds))].filter((id) =>
    songs.some((s) => s.id === id)
  )

  async function applyTagsToSession(): Promise<void> {
    if (tags.length === 0 || sessionAddedIds.length === 0) return
    await window.api.library.retagMany(sessionAddedIds, { tags })
    showNotice(`Tagged ${sessionAddedIds.length} imported item${sessionAddedIds.length === 1 ? '' : 's'}`, 'info')
  }

  async function importUrl(): Promise<void> {
    const clean = url.trim()
    if (!clean) return
    setUrlError(null)
    setUrl('') // non-blocking: clear immediately, the table tracks progress
    const res = await window.api.library.addUrl(clean, opts)
    if (!res.ok) setUrlError(res.error ?? 'Could not add that URL')
  }

  async function chooseFiles(): Promise<void> {
    const res = await window.api.library.addFiles(opts)
    if (!res.ok) showNotice(res.error ?? 'Could not import files', 'error')
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const res = await window.api.library.addDroppedFiles(files, opts)
    if (!res.ok) showNotice(res.error ?? 'No audio files in that drop', 'error')
  }

  return (
    <div className="pane workbench-pane">
      <div className="pane-header">
        <span className="pane-title">
          <button
            className="icon"
            title="Back to library"
            aria-label="Back to library"
            onClick={() => setWorkspace('library')}
          >
            <Icon name="chevron-right" size={16} className="flip" />
          </button>
          <Icon name="inbox" size={15} />
          Import audio
        </span>
      </div>
      <div className="pane-body workbench-body">
        <div className="workbench-head">
          <div className="workbench-eyebrow">library · import</div>
          <h1 className="workbench-title">Import audio</h1>
          <div className="workbench-caption">
            Drop files or paste a link — importing never opens a dialog and never stops the
            music. Items land in your library automatically, loudness-matched at playback.
          </div>
        </div>

        <div className="workbench-inputs">
          <div
            className={`workbench-drop ${dragOver ? 'drop-target' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={(e) => {
              e.preventDefault()
              dragDepth.current += 1
              setDragOver(true)
            }}
            onDragLeave={() => {
              dragDepth.current -= 1
              if (dragDepth.current <= 0) setDragOver(false)
            }}
            onDrop={(e) => void onDrop(e)}
          >
            <Icon name="upload" size={20} />
            <div>
              <b>Drop audio files here</b>
              <div className="sub">
                or{' '}
                <button className="workbench-choose" onClick={() => void chooseFiles()}>
                  browse…
                </button>{' '}
                — MP3, FLAC, OGG, WAV
              </div>
            </div>
          </div>
          <div className="workbench-link-card">
            <div className="builder-label">Paste a link</div>
            <div className="workbench-url-row">
              <input
                type="text"
                value={url}
                placeholder="https://…"
                aria-label="Audio URL"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void importUrl()
                }}
              />
              <button className="btn primary" disabled={!url.trim()} onClick={() => void importUrl()}>
                <Icon name="download" size={14} /> Import
              </button>
            </div>
            <div className="sub">
              YouTube · SoundCloud · Bandcamp — a playlist brings every track
            </div>
          </div>
        </div>
        {urlError && (
          <div className="wizard-error" role="alert">
            <div className="wizard-error-msg">{urlError}</div>
            <div className="wizard-error-fix">
              <button className="primary" disabled={updatingYtdlp} onClick={() => void updateYtdlp()}>
                {updatingYtdlp ? 'Updating yt-dlp…' : 'Update yt-dlp'}
              </button>
              <span className="muted small" style={{ padding: 0 }}>
                A “sign in / confirm you’re not a bot” error is usually a stale yt-dlp — update
                it, then Import again.
              </span>
            </div>
          </div>
        )}

        <div className="workbench-opts">
          <div className="draft-control">
            <span className="builder-label">
              Import as {KIND_GLYPHS[kind]} {KIND_LABELS[kind]}
            </span>
            <SegmentedControl<ItemKind>
              options={KIND_ORDER.map((k) => ({ value: k, label: `${KIND_GLYPHS[k]} ${KIND_LABELS[k]}` }))}
              value={kind}
              onChange={setKind}
            />
          </div>
          <div className="draft-control workbench-tags">
            <span className="builder-label">Tags for everything imported here</span>
            <TagPicker kind={kind} value={tags} onChange={setTags} />
            {sessionAddedIds.length > 0 && (
              <button
                className="btn workbench-apply"
                disabled={tags.length === 0}
                title="Apply the tags above to everything imported in this session"
                onClick={() => void applyTagsToSession()}
              >
                Apply tags to {sessionAddedIds.length} imported item
                {sessionAddedIds.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>

        {(() => {
          const lastDone = importRows.find((r) => r.status === 'done' && r.addedSongIds.length > 0)
          const ids = lastDone?.addedSongIds.filter((id) => songs.some((s) => s.id === id)) ?? []
          if (ids.length === 0) return null
          return (
            <div className="triage-banner">
              <Icon name="sparkle" size={14} />
              <span>
                {ids.length} new item{ids.length === 1 ? '' : 's'} just landed.
              </span>
              <button className="btn" onClick={() => startTriage(ids)}>
                Tag with preview →
              </button>
            </div>
          )
        })()}

        <div className="workbench-section-head">
          <h2 className="workbench-section-title">Importing now</h2>
          <span className="workbench-section-meta">
            {importRows.length === 0
              ? 'nothing arriving'
              : `${importRows.length} source${importRows.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {importRows.length === 0 ? (
          <div className="muted small">Paste a link or drop files above.</div>
        ) : (
          <div className="workbench-table">
            {importRows.map((r, i) => (
              <ArrivingRow
                key={`${r.url}:${importRows.length - i}`}
                row={r}
                listeningId={listeningId}
                setListeningId={setListeningId}
              />
            ))}
          </div>
        )}

        <div className="workbench-section-head">
          <h2 className="workbench-section-title">Untagged</h2>
          <span className="workbench-section-meta">
            {inbox.length === 0 ? 'all clear' : `${inbox.length} waiting`}
          </span>
          {inbox.length > 0 && (
            <button
              className="btn workbench-section-action"
              title="Audition each untagged item and tag as you listen"
              onClick={() => startTriage(inbox.map((x) => x.id))}
            >
              <Icon name="headphones" size={13} /> Tag with preview →
            </button>
          )}
        </div>
        {inbox.length === 0 ? (
          <div className="muted small">Everything in your library has at least one tag.</div>
        ) : (
          <>
            <div className="workbench-table">
              {inbox.map((s) => (
                <div key={s.id} className="row workbench-row">
                  <span className="workbench-row-icon" aria-hidden="true">
                    {KIND_GLYPHS[(s.kind ?? 'track') as ItemKind]}
                  </span>
                  <div className="title">
                    <span className="song-title">{s.title}</span>
                  </div>
                  <ListenButton song={s} listeningId={listeningId} setListeningId={setListeningId} />
                  <button
                    className="btn"
                    title="Tag with preview, starting from this item"
                    onClick={() => {
                      const at = inbox.findIndex((x) => x.id === s.id)
                      startTriage(inbox.slice(Math.max(0, at)).map((x) => x.id))
                    }}
                  >
                    Tag →
                  </button>
                </div>
              ))}
            </div>
            <div className="workbench-footnote">
              Untagged audio still plays and still turns up in title search — tags just make it
              faster to find mid-session.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
