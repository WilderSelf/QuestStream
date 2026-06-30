import { fmtTime } from '../store'
import { clamp01 } from '@shared/num'

interface SeekBarProps {
  positionSec: number
  duration: number
  /** Called with the target time in seconds when the user scrubs or nudges. */
  onSeek: (sec: number) => void
  /** When false, the bar is inert (no focus, clicks/keys ignored). Default true. */
  enabled?: boolean
  /** Wrapper class — 'seek' in the transport, 'row-seek' in the queue. */
  className?: string
  /** Swallow click/double-click on the wrapper (queue rows select/restart on those). */
  stopPropagation?: boolean
}

/**
 * The scrub bar shared by the transport and the current queue card: click to seek,
 * arrows nudge ±5s, Home/End jump to the ends. Centralizes the slider a11y contract.
 */
export function SeekBar({
  positionSec,
  duration,
  onSeek,
  enabled = true,
  className = 'seek',
  stopPropagation = false
}: SeekBarProps): JSX.Element {
  const pct = duration > 0 ? Math.min(100, (positionSec / duration) * 100) : 0

  function seek(e: React.MouseEvent<HTMLDivElement>): void {
    if (!enabled || duration <= 0) return
    if (stopPropagation) e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = clamp01((e.clientX - rect.left) / rect.width)
    onSeek(frac * duration)
  }

  function seekKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!enabled || duration <= 0) return
    const step =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : 0
    if (step) {
      e.preventDefault()
      onSeek(Math.min(duration, Math.max(0, positionSec + step)))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onSeek(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      onSeek(duration)
    }
  }

  const swallow = stopPropagation ? (e: React.SyntheticEvent): void => e.stopPropagation() : undefined

  return (
    <div className={className} onClick={swallow} onDoubleClick={swallow}>
      <span className="time">{fmtTime(positionSec)}</span>
      <div
        className="bar"
        role="slider"
        tabIndex={enabled ? 0 : -1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(positionSec)}
        aria-valuetext={`${fmtTime(positionSec)} of ${fmtTime(duration)}`}
        onClick={seek}
        onKeyDown={seekKey}
      >
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="time">{fmtTime(duration)}</span>
    </div>
  )
}
