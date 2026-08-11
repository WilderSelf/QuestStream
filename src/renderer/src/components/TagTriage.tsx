import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, fmtTime } from '../store'
import { triageComplete } from '@shared/triage'
import { suggestTags } from '@shared/tag-suggest'
import { dimensionsFor, normalizeTag, parseTag } from '@shared/taxonomy'
import { newPeaks, appendPeaks, type PeakState } from '@shared/waveform'
import { KIND_ORDER, KIND_LABELS } from '@shared/taxonomy'
import type { ItemKind } from '@shared/types'
import { Icon } from './Icon'
import { SegmentedControl } from './SegmentedControl'
import { TagPicker } from './TagPicker'

// One waveform bar per fixed slice of audio (0.25s of 48kHz stereo), regardless of
// track length — a 3-hour video draws as vividly as a 4-second sting. The canvas
// shows the most recent window and scrolls once full.
const SAMPLES_PER_BAR = 24_000
const BAR_W = 2
const BAR_GAP = 1
const KEEP_BARS = 1200 // trim the fold beyond this so long auditions stay bounded

/**
 * Streaming waveform: folds preview:pcm into fixed-time peak bars (rAF-throttled
 * draw), sized to the element's real width. Resets when the auditioned song changes.
 */
function Waveform({ songId }: { songId: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<PeakState>(newPeaks())
  const rafRef = useRef(0)

  useEffect(() => {
    peaksRef.current = newPeaks() // new song → fresh canvas
    const draw = (): void => {
      rafRef.current = 0
      const canvas = canvasRef.current
      if (!canvas) return
      // Match the internal bitmap to the rendered size so bars are never stretched.
      if (canvas.width !== canvas.clientWidth && canvas.clientWidth > 0) {
        canvas.width = canvas.clientWidth
      }
      const ctx2d = canvas.getContext('2d')
      if (!ctx2d) return
      const { width, height } = canvas
      ctx2d.clearRect(0, 0, width, height)
      const style = getComputedStyle(canvas)
      ctx2d.fillStyle = style.getPropertyValue('color') || '#c9a86a'
      const maxBars = Math.max(1, Math.floor(width / (BAR_W + BAR_GAP)))
      // The most recent window, scrolling once the canvas is full.
      const peaks = peaksRef.current.peaks.slice(-maxBars)
      for (let i = 0; i < peaks.length; i++) {
        const h = Math.max(2, peaks[i] * height)
        ctx2d.fillRect(i * (BAR_W + BAR_GAP), (height - h) / 2, BAR_W, h)
      }
    }
    const off = window.api.preview.onPcm((pcm) => {
      const view = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength >> 1)
      let next = appendPeaks(peaksRef.current, view, SAMPLES_PER_BAR, Number.MAX_SAFE_INTEGER)
      if (next.peaks.length > KEEP_BARS) next = { ...next, peaks: next.peaks.slice(-KEEP_BARS) }
      peaksRef.current = next
      if (!rafRef.current) rafRef.current = requestAnimationFrame(draw)
    })
    const onResize = (): void => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(draw)
    }
    window.addEventListener('resize', onResize)
    draw()
    return () => {
      off()
      window.removeEventListener('resize', onResize)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [songId])

  return (
    <div className="triage-wave">
      <canvas ref={canvasRef} height={96} aria-hidden="true" />
    </div>
  )
}

/**
 * The tag-triage workspace (grimoire Phase 7): audition-first tagging through
 * the preview bus only. Space toggles listening, Enter saves & advances, S
 * skips — mirrored by the visible buttons.
 */
export function TagTriage(): JSX.Element | null {
  const triage = useStore((s) => s.triage)
  const songs = useStore((s) => s.library.songs)
  const triageAct = useStore((s) => s.triageAct)
  const triagePreviewToggle = useStore((s) => s.triagePreviewToggle)
  const exitTriage = useStore((s) => s.exitTriage)
  const setTriageInput = useStore((s) => s.setTriageInput)
  const previewing = useStore((s) => s.previewStatus?.playing ?? false)
  const position = useStore((s) => s.previewStatus?.positionSec ?? 0)
  const [query, setQuery] = useState('')

  const customTags = useMemo(() => {
    const free = new Set<string>()
    for (const s of songs) for (const t of s.tags ?? []) if (!parseTag(t).dim) free.add(t)
    return [...free]
  }, [songs])

  // Keep the keymap's view of the input in sync (Enter-on-empty saves & advances).
  useEffect(() => {
    setTriageInput(useStore.getState().triageInputFocused, query.trim() === '')
  }, [query, setTriageInput])

  if (!triage) return null
  const complete = triageComplete(triage)
  const song = complete ? undefined : songs.find((s) => s.id === triage.queue[triage.index])
  const suggestions = song
    ? suggestTags(query, dimensionsFor(triage.workingKind), customTags, 6)
    : []

  const addTag = (tag: string): void => {
    const t = normalizeTag(tag)
    if (t && !triage.workingTags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      triageAct({ type: 'set-tags', tags: [...triage.workingTags, t] })
    }
    setQuery('')
  }

  return (
    <div className="pane triage-pane">
      <div className="pane-header">
        <span className="pane-title">
          <button
            className="icon"
            title="Back to library"
            aria-label="Back to library"
            onClick={exitTriage}
          >
            <Icon name="chevron-right" size={16} className="flip" />
          </button>
          <Icon name="sparkle" size={15} />
          Tag with preview
          {!complete && (
            <span className="triage-progress">
              {triage.index + 1} of {triage.queue.length}
            </span>
          )}
        </span>
        <span className="header-actions">
          <label className="scene-page-toggle" title="Start each item from the last saved tags">
            <input
              type="checkbox"
              checked={triage.carryForward}
              onChange={() => triageAct({ type: 'toggle-carry' })}
            />
            Carry tags forward
          </label>
        </span>
      </div>
      <div className="pane-body triage-body">
        {complete ? (
          <div className="triage-done">
            <Icon name="sparkle" size={22} />
            <h2>Batch done</h2>
            <p className="muted">
              Tagged {triage.saved.length} · skipped {triage.skippedIds.length}.
            </p>
            <button className="btn primary" onClick={exitTriage}>
              Back to library
            </button>
          </div>
        ) : (
          <>
            <div className="triage-card">
              <div className="triage-title-row">
                <h2 className="triage-title">{song?.title ?? 'Missing item'}</h2>
                {previewing && (
                  <span className="preview-badge">
                    <Icon name="headphones" size={13} /> Only you hear this
                  </span>
                )}
              </div>
              <div className="triage-meta">
                {song?.sourceType === 'local' ? 'Local file' : song?.sourceType ?? ''}
                {song ? ` · ${fmtTime(song.duration)}` : ''}
              </div>
              {song && <Waveform songId={song.id} />}
              <div className="triage-listen-row">
                <button
                  className={`btn ${previewing ? 'active' : ''}`}
                  title="Toggle listening (Space)"
                  aria-pressed={previewing}
                  onClick={triagePreviewToggle}
                >
                  <Icon name={previewing ? 'pause' : 'play'} size={14} />{' '}
                  {previewing ? 'Pause' : 'Listen'} <kbd>Space</kbd>
                </button>
                {song && (
                  <span className="triage-elapsed">
                    {fmtTime(position)} / {fmtTime(song.duration)}
                  </span>
                )}
              </div>
            </div>

            <div className="draft-control">
              <span className="builder-label">This is…</span>
              <SegmentedControl<ItemKind>
                options={KIND_ORDER.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
                value={triage.workingKind}
                onChange={(kind) => triageAct({ type: 'set-kind', kind })}
              />
            </div>

            <TagPicker
              kind={triage.workingKind}
              value={triage.workingTags}
              onChange={(tags) => triageAct({ type: 'set-tags', tags })}
            />

            <div className="triage-typeahead">
              <input
                type="text"
                value={query}
                placeholder="Type to find a tag… ('tav' → Tavern)"
                aria-label="Find a tag"
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setTriageInput(true, query.trim() === '')}
                onBlur={() => setTriageInput(false, query.trim() === '')}
                onKeyDown={(e) => {
                  // Enter with text picks the top suggestion; Enter on empty is the
                  // keymap's save-and-next (suppressed here so it can fire globally).
                  if (e.key === 'Enter' && query.trim()) {
                    e.preventDefault()
                    addTag(suggestions[0]?.tag ?? query)
                  }
                }}
              />
              {query.trim() && suggestions.length > 0 && (
                <div className="triage-suggestions" role="listbox">
                  {suggestions.map((s) => (
                    <button key={s.tag} className="triage-suggestion" onClick={() => addTag(s.tag)}>
                      {s.dimLabel ? `${s.dimLabel} · ${s.label}` : s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="triage-actions">
              <button className="btn primary" onClick={() => triageAct({ type: 'save-next' })}>
                Save &amp; next <kbd>Enter</kbd>
              </button>
              <button className="btn" onClick={() => triageAct({ type: 'skip' })}>
                Skip <kbd>S</kbd>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
