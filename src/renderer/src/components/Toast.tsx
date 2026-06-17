import { useStore } from '../store'

export function Toast(): JSX.Element | null {
  const imp = useStore((s) => s.importStatus)
  const notice = useStore((s) => s.notice)

  // A general notice (playback guard, errors) takes priority over import status.
  if (notice) {
    return <div className={`toast ${notice.kind === 'error' ? 'error' : ''}`}>{notice.text}</div>
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

  return <div className={`toast ${imp.status === 'error' ? 'error' : ''}`}>{text}</div>
}
