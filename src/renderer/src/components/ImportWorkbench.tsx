import { useRef, useState } from 'react'
import { useStore } from '../store'
import type { ItemKind } from '@shared/types'
import type { ImportRow } from '@shared/import-flow'
import { KIND_ORDER, KIND_LABELS } from '@shared/taxonomy'
import { Icon } from './Icon'
import { SegmentedControl } from './SegmentedControl'
import { TagPicker } from './TagPicker'

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

function ArrivingRow({ row }: { row: ImportRow }): JSX.Element {
  const failed = row.status === 'error'
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
        <span className="song-title">{row.url}</span>
        <div className={`sub ${failed ? 'workbench-error' : ''}`}>{rowStatusText(row)}</div>
      </div>
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

  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<ItemKind>(kindTab)
  const [tags, setTags] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const dragDepth = useRef(0)

  const opts = { kind, tags }

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
        <div className="workbench-caption">
          Items land in your library automatically — loudness-matched at playback.
        </div>

        <div className="workbench-url-row">
          <input
            type="text"
            value={url}
            placeholder="Paste a link (YouTube / SoundCloud / …) — a playlist imports all its tracks"
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
            Drop audio files here, or{' '}
            <button className="workbench-choose" onClick={() => void chooseFiles()}>
              choose files…
            </button>
          </div>
        </div>

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
          </div>
        </div>

        <div className="section-label">
          <Icon name="download" size={13} /> Arriving · {importRows.length}
        </div>
        {importRows.length === 0 ? (
          <div className="muted small">Nothing arriving — paste a link or drop files above.</div>
        ) : (
          <div className="workbench-table">
            {importRows.map((r, i) => (
              <ArrivingRow key={`${r.url}:${importRows.length - i}`} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
