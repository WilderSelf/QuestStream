import { useStore } from '../store'
import { Icon } from './Icon'

export function TopBar(): JSX.Element {
  const bot = useStore((s) => s.bot)
  const guilds = useStore((s) => s.guilds)
  const channels = useStore((s) => s.channels)
  const selectedGuildId = useStore((s) => s.selectedGuildId)
  const selectedChannelId = useStore((s) => s.selectedChannelId)
  const selectGuild = useStore((s) => s.selectGuild)
  const selectChannel = useStore((s) => s.selectChannel)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const showNotice = useStore((s) => s.showNotice)

  const inChannel = !!bot.activeChannelId

  async function joinOrLeave(): Promise<void> {
    if (inChannel) {
      await window.api.discord.leave()
    } else if (selectedGuildId && selectedChannelId) {
      try {
        await window.api.discord.join(selectedGuildId, selectedChannelId)
      } catch (err) {
        showNotice((err as Error).message, 'error')
      }
    }
  }

  const statusLabel =
    bot.state === 'ready'
      ? bot.username ?? 'Connected'
      : bot.state === 'connecting'
        ? 'Connecting…'
        : bot.state === 'error'
          ? bot.error ?? 'Error'
          : 'Offline'

  return (
    <div className="topbar">
      <span className="brand">♪ QUESTSTREAM</span>

      <div className="spacer" />

      <span className="status-pill" title={bot.error ?? statusLabel}>
        <span className={`dot ${bot.state}`} aria-hidden="true" />
        {statusLabel}
      </span>

      {bot.state === 'ready' && (
        <>
          <select
            value={selectedGuildId ?? ''}
            onChange={(e) => void selectGuild(e.target.value)}
            title="Server"
            aria-label="Discord server"
          >
            {guilds.length === 0 && <option value="">No servers</option>}
            {guilds.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            value={selectedChannelId ?? ''}
            onChange={(e) => selectChannel(e.target.value)}
            title="Voice channel"
            aria-label="Voice channel"
          >
            {channels.length === 0 && <option value="">No voice channels</option>}
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                🔊 {c.name}
              </option>
            ))}
          </select>
          <button
            className={inChannel ? '' : 'primary'}
            disabled={!inChannel && !selectedChannelId}
            onClick={() => void joinOrLeave()}
          >
            {inChannel ? 'Leave' : 'Join'}
          </button>
        </>
      )}

      <button className="icon" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        <Icon name="settings" size={16} />
      </button>
    </div>
  )
}
