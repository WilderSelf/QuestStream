import { useState } from 'react'
import { useStore } from '../store'

export function TopBar(): JSX.Element {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
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

  const inChannel = !!bot.activeChannelId

  async function addUrl(): Promise<void> {
    const clean = url.trim()
    if (!clean) return
    setBusy(true)
    setUrl('')
    const res = await window.api.library.addUrl(clean)
    if (!res.ok) showNotice(res.error ?? 'Could not add that URL', 'error')
    setBusy(false)
  }

  async function addFiles(): Promise<void> {
    setBusy(true)
    const res = await window.api.library.addFiles()
    if (!res.ok) showNotice(res.error ?? 'Could not import files', 'error')
    else if (res.added > 0) showNotice(`Added ${res.added} local file${res.added > 1 ? 's' : ''}`, 'info')
    setBusy(false)
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

      <input
        className="search-box"
        placeholder="🔍 Filter library…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="add-url">
        <input
          placeholder="Paste a YouTube / SoundCloud / Bandcamp URL…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addUrl()}
        />
        <button className="primary" disabled={busy || !url.trim()} onClick={() => void addUrl()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button className="icon" title="Add local audio files" disabled={busy} onClick={() => void addFiles()}>
          📁
        </button>
      </div>

      <div className="spacer" />

      <span className="status-pill" title={bot.error ?? statusLabel}>
        <span className={`dot ${bot.state}`} />
        {statusLabel}
      </span>

      {bot.state === 'ready' && (
        <>
          <select
            value={selectedGuildId ?? ''}
            onChange={(e) => void selectGuild(e.target.value)}
            title="Server"
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

      <button className="icon" title="Settings" onClick={() => setSettingsOpen(true)}>
        ⚙
      </button>
    </div>
  )
}
