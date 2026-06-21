import { useStore } from '../store'

export function Toast(): JSX.Element | null {
  const imp = useStore((s) => s.importStatus)
  const notice = useStore((s) => s.notice)
  const dismissNotice = useStore((s) => s.dismissNotice)

  // A general notice (playback guard, transient errors) takes priority over import status.
  // Blocking conditions are handled by AlertBanner, not here.
  if (notice) {
    const isError = notice.kind === 'error'
    return (
      // Errors are assertive (announced immediately); info is polite. Icon + text so the
      // meaning isn't carried by colour alone.
      <div
        className={`toast ${isError ? 'error' : ''}`}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
      >
        <span className="toast-icon" aria-hidden="true">
          {isError ? '⚠' : 'ℹ'}
        </span>
        <span className="toast-text">{notice.text}</span>
        <button className="toast-close" title="Dismiss" aria-label="Dismiss" onClick={dismissNotice}>
          ✕
        </button>
      </div>
    )
  }

  if (!imp) return null

  let text: string
  switch (imp.status) {
    case 'resolving':
      text = 'Resolving URL…'
      break
    case 'importing':
      text = `Importing ${imp.completed ?? 0}/${imp.total ?? '?'}…`
      break
    case 'done':
      text = `Added ${imp.addedSongIds?.length ?? 0} track(s) to your library.`
      break
    case 'error':
      text = `Import failed: ${imp.message ?? 'unknown error'}`
      break
    default:
      text = ''
  }

  return (
    <div className={`toast ${imp.status === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      <span className="toast-text">{text}</span>
    </div>
  )
}
