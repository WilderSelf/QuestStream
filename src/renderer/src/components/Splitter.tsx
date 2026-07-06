import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * A thin draggable divider between two panes. `value` is the LEADING pane's fraction of the two
 * panes' combined size (0..1); dragging (or the arrow keys) reports a new fraction via `onChange`,
 * and the parent turns that into grid `fr` units. Kept library-free: pointer capture on the handle
 * means the drag keeps tracking even if the cursor outruns the 6px hit area.
 *
 * The fraction is measured against the two adjacent panes only (the handle's previous/next siblings),
 * not the whole container — the browser grid has an `auto` rail column that must not count toward the
 * split. Double-click resets to the default; it's keyboard-operable as an ARIA separator.
 */
export function Splitter({
  orientation,
  value,
  onChange,
  onReset,
  min = 0.2,
  max = 0.8,
  ariaLabel
}: {
  orientation: 'vertical' | 'horizontal'
  value: number
  onChange: (v: number) => void
  onReset: () => void
  min?: number
  max?: number
  ariaLabel?: string
}): JSX.Element {
  const dragging = useRef(false)
  const clamp = (v: number): number => Math.max(min, Math.min(max, v))

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
    const frac =
      orientation === 'vertical'
        ? (e.clientX - lead.left) / (lead.width + trail.width)
        : (e.clientY - lead.top) / (lead.height + trail.height)
    onChange(clamp(frac))
  }

  function stopDrag(e: PointerEvent<HTMLDivElement>): void {
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const back = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const fwd = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === back) onChange(clamp(value - 0.02))
    else if (e.key === fwd) onChange(clamp(value + 0.02))
    else if (e.key === 'Home') onChange(min)
    else if (e.key === 'End') onChange(max)
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
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
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
