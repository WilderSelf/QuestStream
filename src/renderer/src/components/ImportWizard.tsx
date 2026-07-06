import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { SegmentedControl } from './SegmentedControl'
import type { ItemKind, Song } from '@shared/types'
import {
  KIND_ORDER,
  KIND_LABELS,
  dimensionsFor,
  makeTag,
  normalizeTag,
  parseTag,
  labelForValue
} from '@shared/taxonomy'
import { colorForTag } from '@shared/tagColors'

/** Pick namespaced tags for one item, grouped by the kind's dimensions, + a custom field. */
export function TagPicker({
  kind,
  value,
  onChange
}: {
  kind: ItemKind
  value: string[]
  onChange: (tags: string[]) => void
}): JSX.Element {
  const [custom, setCustom] = useState('')
  const tagColors = useStore((s) => s.tagColors)
  const has = (tag: string): boolean => value.some((t) => t.toLowerCase() === tag.toLowerCase())
  const toggle = (tag: string): void =>
    onChange(has(tag) ? value.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...value, tag])
  const addCustom = (): void => {
    const t = normalizeTag(custom)
    if (t && !has(t)) onChange([...value, t])
    setCustom('')
  }
  const free = value.filter((t) => !parseTag(t).dim)

  return (
    <div className="tag-picker">
      {dimensionsFor(kind).map((d) => (
        <div className="filter-row" key={d.key}>
          <span className="filter-label">{d.label}</span>
          {d.values.map((v) => {
            const tag = makeTag(d.key, v.value)
            return (
              <button
                key={v.value}
                className={`tag-chip ${has(tag) ? 'active' : ''}`}
                style={{ '--tag-color': colorForTag(tag, tagColors) } as React.CSSProperties}
                onClick={() => toggle(tag)}
              >
                {v.label}
              </button>
            )
          })}
        </div>
      ))}
      <div className="filter-row">
        <span className="filter-label">Custom</span>
        {free.map((t) => (
          <span
            key={t}
            className="tag-chip active tag-removable"
            style={{ '--tag-color': colorForTag(t, tagColors) } as React.CSSProperties}
            onClick={() => toggle(t)}
          >
            {t} <Icon name="x" size={11} />
          </span>
        ))}
        <input
          className="custom-tag"
          value={custom}
          placeholder="add a tag, Enter"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
        />
      </div>
    </div>
  )
}

type Source = 'url' | 'files'
type Mode = 'batch' | 'peritem'
type Phase = 'setup' | 'peritem'

export function ImportWizardModal(): JSX.Element | null {
  const open = useStore((s) => s.importWizardOpen)
  const setOpen = useStore((s) => s.setImportWizardOpen)
  const importStatus = useStore((s) => s.importStatus)
  const songs = useStore((s) => s.library.songs)
  const kindTab = useStore((s) => s.kindTab)
  const updateYtdlp = useStore((s) => s.updateYtdlp)
  const updatingYtdlp = useStore((s) => s.updatingYtdlp)

  const [source, setSource] = useState<Source>('url')
  const [url, setUrl] = useState('')
  // Default the import Type to whichever library section the user is in (Music/Ambience/SFX).
  const [kind, setKind] = useState<ItemKind>(kindTab)
  const [mode, setMode] = useState<Mode>('batch')
  const [batchTags, setBatchTags] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase>('setup')
  const [busy, setBusy] = useState(false)
  const [importedIds, setImportedIds] = useState<string[]>([])
  const [perItem, setPerItem] = useState<Record<string, string[]>>({})
  const [error, setError] = useState<string | null>(null)

  // Reset to a clean slate each time the wizard opens. Read the prefill/kind snapshot
  // imperatively (not as effect deps) so only the open transition resets the form — a later
  // change to kindTab/prefill while the wizard is open can't wipe the user's in-progress input.
  useEffect(() => {
    if (!open) return
    const { kindTab, importWizardUrl, importWizardSource } = useStore.getState()
    setSource(importWizardSource)
    setUrl(importWizardUrl) // pre-filled when opened from the top-bar quick-add box
    setKind(kindTab)
    setMode('batch')
    setBatchTags([])
    setPhase('setup')
    setBusy(false)
    setImportedIds([])
    setPerItem({})
    setError(null)
  }, [open])

  // In per-item mode we kick off the import, then wait for the `done` progress event
  // to learn which songs were created so they can be tagged individually.
  useEffect(() => {
    if (phase !== 'peritem' || !busy) return
    if (importStatus?.status === 'done') {
      setImportedIds(importStatus.addedSongIds ?? [])
      setBusy(false)
    } else if (importStatus?.status === 'error') {
      setError(importStatus.message ?? 'Import failed')
      setBusy(false)
      setPhase('setup') // back to the form so the error shows where the user can retry
    }
  }, [importStatus, phase, busy])

  if (!open) return null

  const canStart = source === 'files' || url.trim().length > 0

  async function startImport(): Promise<void> {
    setBusy(true)
    setError(null)
    const opts =
      mode === 'batch' ? { kind, tags: batchTags } : { kind } // per-item tags applied after
    if (mode === 'peritem') setPhase('peritem')
    if (source === 'url') {
      const res = await window.api.library.addUrl(url.trim(), opts)
      if (!res.ok) {
        setError(res.error ?? 'Could not add that URL')
        setBusy(false)
        if (mode === 'peritem') setPhase('setup')
        return
      }
    } else {
      const res = await window.api.library.addFiles(opts)
      if (!res.ok) {
        setError(res.error ?? 'Could not import files')
        setBusy(false)
        if (mode === 'peritem') setPhase('setup')
        return
      }
      if (res.added === 0) {
        // user cancelled the file picker
        setBusy(false)
        if (mode === 'peritem') setPhase('setup')
        return
      }
    }
    if (mode === 'batch') setOpen(false) // success: the queue/library updates live
    // per-item: the progress effect takes over once `done` arrives
  }

  async function finishPerItem(): Promise<void> {
    for (const id of importedIds) {
      const tags = perItem[id]
      if (tags && tags.length) await window.api.library.retag(id, { tags })
    }
    setOpen(false)
  }

  const importedSongs: Song[] = importedIds
    .map((id) => songs.find((s) => s.id === id))
    .filter((s): s is Song => !!s)

  return (
    <Modal
      onClose={() => setOpen(false)}
      dismissable={!busy}
      className="wizard"
      labelledBy="wizard-title"
    >
        {phase === 'setup' ? (
          <>
            <h2 id="wizard-title">Import audio</h2>

            <div className="field">
              <div className="field-label">Source</div>
              <SegmentedControl
                value={source}
                onChange={setSource}
                options={[
                  { value: 'url', label: 'Link (YouTube / SoundCloud / …)' },
                  { value: 'files', label: 'Local files' }
                ]}
              />
              {source === 'url' ? (
                <input
                  autoFocus
                  value={url}
                  aria-label="Audio URL"
                  placeholder="Paste a URL (a playlist imports all its tracks)"
                  onChange={(e) => setUrl(e.target.value)}
                />
              ) : (
                <p className="muted small" style={{ padding: 0 }}>
                  A file picker opens when you start the import; pick one or more audio files.
                </p>
              )}
            </div>

            <div className="field">
              <div className="field-label">Type</div>
              <SegmentedControl
                value={kind}
                onChange={setKind}
                options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
              />
            </div>

            <div className="field">
              <div className="field-label">Tagging</div>
              <SegmentedControl
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'batch', label: 'All at once' },
                  { value: 'peritem', label: 'One by one' }
                ]}
              />
              <p className="muted small" style={{ padding: 0 }}>
                {mode === 'batch'
                  ? 'Apply the type and tags below to every imported item — fast for a whole playlist.'
                  : 'Import first, then tag each item individually — precise, slower for big playlists.'}
              </p>
            </div>

            {mode === 'batch' && (
              <div className="field">
                <div className="field-label">Tags</div>
                <TagPicker kind={kind} value={batchTags} onChange={setBatchTags} />
              </div>
            )}

            {error && (
              <div className="wizard-error" role="alert">
                <div className="wizard-error-msg">{error}</div>
                {source === 'url' && (
                  <div className="wizard-error-fix">
                    <button
                      className="primary"
                      disabled={updatingYtdlp}
                      onClick={() => void updateYtdlp()}
                    >
                      {updatingYtdlp ? 'Updating yt-dlp…' : 'Update yt-dlp'}
                    </button>
                    <span className="muted small" style={{ padding: 0 }}>
                      A “sign in / confirm you’re not a bot” error is usually a stale yt-dlp —
                      update it, then Import again.
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="actions">
              <button onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary" disabled={!canStart || busy} onClick={() => void startImport()}>
                {busy ? 'Importing…' : source === 'files' ? 'Choose files…' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="wizard-title">Tag imported items</h2>
            {busy ? (
              <p className="muted">
                Importing…{' '}
                {importStatus?.total
                  ? `(${importStatus.completed ?? 0}/${importStatus.total})`
                  : ''}
              </p>
            ) : importedSongs.length === 0 ? (
              <p className="muted">
                Nothing new to tag — these were already in your library, so no duplicates were
                added.
              </p>
            ) : (
              <div className="peritem-list">
                {importedSongs.map((s) => (
                  <div className="peritem" key={s.id}>
                    <div className="peritem-title">{s.title}</div>
                    <TagPicker
                      kind={kind}
                      value={perItem[s.id] ?? []}
                      onChange={(tags) => setPerItem((p) => ({ ...p, [s.id]: tags }))}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="actions">
              <button className="primary" disabled={busy} onClick={() => void finishPerItem()}>
                Done
              </button>
            </div>
          </>
        )}
    </Modal>
  )
}
