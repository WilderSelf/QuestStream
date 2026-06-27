import { useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'

export function TopBar(): JSX.Element {
  const [url, setUrl] = useState('')
  const bot = useStore((s) => s.bot)
  const guilds = useStore((s) => s.guilds)
  const channels = useStore((s) => s.channels)
  const selectedGuildId = useStore((s) => s.selectedGuildId)
  const selectedChannelId = useStore((s) => s.selectedChannelId)
  const selectGuild = useStore((s) => s.selectGuild)
  const selectChannel = useStore((s) => s.selectChannel)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const showNotice = useStore((s) => s.showNotice)
  const openImportWizard = useStore((s) => s.openImportWizard)

  const inChannel = !!bot.activeChannelId

  // Both the URL box and the local-files button hand off to the import wizard so every import
  // goes through the same type/tag step (the wizard's file picker opens for the 'files' source).
  function addUrl(): void {
    const clean = url.trim()
    if (!clean) return
    setUrl('')
    openImportWizard({ url: clean })
  }

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

      <div className="search-wrap">
        <Icon name="search" size={14} className="search-icon" />
        <input
          className="search-box"
          placeholder="Filter library…"
          aria-label="Filter library"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="add-url">
        <input
          placeholder="Paste a YouTube / SoundCloud / Bandcamp URL…"
          aria-label="Add audio from a URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addUrl()}
        />
        <button className="primary" disabled={!url.trim()} onClick={() => addUrl()}>
          Add
        </button>
        <button
          className="icon"
          title="Add local audio files"
          aria-label="Add local audio files"
          onClick={() => openImportWizard({ source: 'files' })}
        >
          <Icon name="folder" size={16} />
        </button>
      </div>

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
