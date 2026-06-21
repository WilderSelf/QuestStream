import { useStore } from '../store'

interface Alert {
  key: string
  text: string
  dismiss: () => void
  action?: { label: string; run: () => void; busy?: boolean }
}

/**
 * Persistent, full-width banners for blocking app conditions — a required external
 * tool is missing, the Discord bot failed to connect, playback keeps failing, etc.
 * Unlike a toast these do NOT auto-dismiss: a standing problem the user must act on
 * should stay visible until they close it. Rendered at the top of the main area so
 * they push content down rather than overlaying it. Transient, per-event failures
 * (a single track that won't play) stay as toasts instead.
 */
export function AlertBanner(): JSX.Element | null {
  const blockingAlert = useStore((s) => s.blockingAlert)
  const dismissAlert = useStore((s) => s.dismissAlert)
  const bot = useStore((s) => s.bot)
  const botErrorDismissed = useStore((s) => s.botErrorDismissed)
  const dismissBotError = useStore((s) => s.dismissBotError)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const updateYtdlp = useStore((s) => s.updateYtdlp)
  const updatingYtdlp = useStore((s) => s.updatingYtdlp)
  const suggestYtdlpUpdate = useStore((s) => s.suggestYtdlpUpdate)
  const dismissYtdlpSuggestion = useStore((s) => s.dismissYtdlpSuggestion)

  const updateAction = {
    label: updatingYtdlp ? 'Updating…' : 'Update yt-dlp',
    run: () => void updateYtdlp(),
    busy: updatingYtdlp
  }

  const alerts: Alert[] = []

  // Missing external tools (yt-dlp/ffmpeg) — no playback at all until fixed. If yt-dlp
  // is the culprit, offer the one-click download fix right in the banner.
  if (blockingAlert) {
    alerts.push({
      key: 'tools',
      text: blockingAlert,
      dismiss: dismissAlert,
      action: /yt-dlp/i.test(blockingAlert) ? updateAction : undefined
    })
  }

  // Repeated playback failures — usually a stale yt-dlp after YouTube changed something.
  if (suggestYtdlpUpdate) {
    alerts.push({
      key: 'stale-ytdlp',
      text: 'Playback keeps failing — your yt-dlp may be out of date.',
      dismiss: dismissYtdlpSuggestion,
      action: updateAction
    })
  }

  // Discord connection failed (bad/revoked token, missing permissions). The local
  // jukebox still works, so it's dismissible; the action jumps to where it's fixed.
  if (bot.state === 'error' && bot.error && bot.error !== botErrorDismissed) {
    alerts.push({
      key: 'discord',
      text: `Discord connection failed: ${bot.error}`,
      dismiss: dismissBotError,
      action: { label: 'Open settings', run: () => setSettingsOpen(true) }
    })
  }

  if (alerts.length === 0) return null

  return (
    <div className="alert-stack">
      {alerts.map((a) => (
        <div key={a.key} className="alert-banner" role="alert" aria-live="assertive">
          <span className="alert-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="alert-text">{a.text}</span>
          {a.action && (
            <button className="alert-action" disabled={a.action.busy} onClick={a.action.run}>
              {a.action.label}
            </button>
          )}
          <button className="alert-close" title="Dismiss" aria-label="Dismiss" onClick={a.dismiss}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
