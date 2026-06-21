import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

const DISMISS_KEY = 'qs.desktopPromptDismissed'

/**
 * A prominent, one-time prompt (shown only when running as an AppImage that hasn't been
 * added to the menu yet) offering one-click installation of a Desktop Entry. AppImages
 * don't register themselves, so this is how a casual user gets a normal launcher.
 */
export function DesktopPrompt(): JSX.Element | null {
  const installDesktopMenu = useStore((s) => s.installDesktopMenu)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === '1') return
    void window.api.desktop.getStatus().then((st) => {
      if (st.isAppImage && !st.installed) setShow(true)
    })
  }, [])

  if (!show) return null

  async function add(): Promise<void> {
    setBusy(true)
    const r = await installDesktopMenu()
    setBusy(false)
    if (r.ok) {
      localStorage.setItem(DISMISS_KEY, '1')
      setShow(false)
    }
  }
  function dismiss(): void {
    localStorage.setItem(DISMISS_KEY, '1')
    setShow(false)
  }

  return (
    <div className="desktop-prompt">
      <span className="desktop-prompt-icon" aria-hidden="true">
        🚀
      </span>
      <span className="desktop-prompt-text">
        Add QuestStream to your applications menu so you can launch it like any other app.
      </span>
      <button className="primary" disabled={busy} onClick={() => void add()}>
        {busy ? 'Adding…' : 'Add to menu'}
      </button>
      <button className="alert-close" title="Not now" aria-label="Not now" onClick={dismiss}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
