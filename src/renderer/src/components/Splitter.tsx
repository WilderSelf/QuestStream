import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * A thin draggable divider between two panes. Kept library-free: pointer capture on the handle means
 * the drag keeps tracking even if the cursor outruns the 6px hit area. Double-click resets; it's
 * keyboard-operable as an ARIA separator.
 *
 * Two modes for `value`/`onChange`:
 * - `'fraction'` (default): the LEADING pane's share (0..1) of the two adjacent panes' combined size,
 *   measured against those siblings only (the browser grid's `auto` rail must not count). The parent
 *   turns it into grid `fr` units.
 * - `'pixel'`: the LEADING pane's size in px (e.g. the rail's width) — reported directly so the parent
 *   can size a fixed-px track.
 */
export function Splitter({
  orientation,
  value,
  onChange,
  onReset,
  min,
  max,
  step,
  mode = 'fraction',
  ariaLabel
}: {
  orientation: 'vertical' | 'horizontal'
  value: number
  onChange: (v: number) => void
  onReset: () => void
  min?: number
  max?: number
  step?: number
  mode?: 'fraction' | 'pixel'
  ariaLabel?: string
}): JSX.Element {
  const lo = min ?? (mode === 'pixel' ? 140 : 0.2)
  const hi = max ?? (mode === 'pixel' ? 360 : 0.8)
  const nudge = step ?? (mode === 'pixel' ? 16 : 0.02)
  const ariaScale = mode === 'pixel' ? 1 : 100
  const dragging = useRef(false)
  const clamp = (v: number): number => Math.max(lo, Math.min(hi, v))

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    if (!dragging.current) return
    const handle = e.currentTarget
    const lead = handle.previousElementSibling?.getBoundingClientRect()
    const trail = handle.nextElementSibling?.getBoundingClientRect()
    if (!lead || !trail) return
    const leadStart = orientation === 'vertical' ? lead.left : lead.top
    const pos = orientation === 'vertical' ? e.clientX : e.clientY
    const span = orientation === 'vertical' ? lead.width + trail.width : lead.height + trail.height
    onChange(clamp(mode === 'pixel' ? pos - leadStart : (pos - leadStart) / span))
  }

  function stopDrag(e: PointerEvent<HTMLDivElement>): void {
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const back = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const fwd = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === back) onChange(clamp(value - nudge))
    else if (e.key === fwd) onChange(clamp(value + nudge))
    else if (e.key === 'Home') onChange(lo)
    else if (e.key === 'End') onChange(hi)
    else if (e.key === 'Enter') onReset()
    else return
    e.preventDefault()
  }

  return (
    <div
      className={`splitter splitter-${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value * ariaScale)}
      aria-valuemin={Math.round(lo * ariaScale)}
      aria-valuemax={Math.round(hi * ariaScale)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDrag}
      onLostPointerCapture={stopDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
