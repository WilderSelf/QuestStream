import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'
import { Icon } from './Icon'

/**
 * Surfaces electron-updater state. Updates download in the background; the only action
 * the user needs is to restart once one is ready, so we show a banner when a download
 * is in progress (progress) or finished ("Restart to update"). Other phases are silent.
 */
export function UpdateBanner(): JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ phase: 'idle' })
  useEffect(() => window.api.update.onStatus(setState), [])

  if (state.phase === 'downloaded') {
    return (
      <div className="update-banner ready" role="status" aria-live="polite">
        <span className="update-icon" aria-hidden="true">
          <Icon name="arrow-up" size={16} />
        </span>
        <span className="update-text">
          QuestStream {state.version ? `${state.version} ` : ''}is ready to install.
        </span>
        <button className="primary" onClick={() => void window.api.update.install()}>
          Restart to update
        </button>
      </div>
    )
  }

  if (state.phase === 'downloading') {
    return (
      <div className="update-banner" role="status" aria-live="polite">
        <span className="update-icon" aria-hidden="true">
          <Icon name="download" size={16} />
        </span>
        <span className="update-text">
          Downloading update{typeof state.percent === 'number' ? ` — ${state.percent}%` : '…'}
        </span>
      </div>
    )
  }

  return null
}
