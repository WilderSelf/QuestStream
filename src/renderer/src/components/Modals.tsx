import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { EFFECT_PRESETS } from '@shared/effects'
import type { RemoteInfo } from '@shared/types'
import { useStore } from '../store'

function RemoteSettings(): JSX.Element {
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [qr, setQr] = useState('')
  const [token, setToken] = useState<string | null>(null)

  const setRemoteActive = useStore((s) => s.setRemoteActive)
  async function apply(i: RemoteInfo): Promise<void> {
    setInfo(i)
    setRemoteActive(i.enabled) // gate the store's remote-state pushes
    setToken(null) // a fresh QR / restart invalidates any revealed token view
    setQr(i.url ? await QRCode.toDataURL(i.url, { margin: 1, width: 176 }) : '')
  }
  useEffect(() => {
    void window.api.remote.getInfo().then(apply)
  }, [])

  async function toggle(): Promise<void> {
    await apply(await window.api.remote.setEnabled(!info?.enabled))
  }
  async function refresh(): Promise<void> {
    await apply(await window.api.remote.getInfo())
  }
  async function reveal(): Promise<void> {
    setToken(await window.api.remote.getToken())
  }
  async function reset(): Promise<void> {
    if (confirm('Rotate the remote token? Every paired phone / Stream Deck must re-pair.'))
      await apply(await window.api.remote.resetToken())
  }

  return (
    <div className="field">
      <label>Phone / Stream Deck remote</label>
      <p className="muted small" style={{ padding: 0 }}>
        Control playback from a phone on the same Wi-Fi (or a Stream Deck via HTTP). Scan the
        QR to pair — the code is one-time and expires in a few minutes. The connection isn’t
        encrypted, so only enable this on networks you trust.
      </p>
      <button onClick={() => void toggle()}>
        {info?.enabled ? `Disable remote (port ${info.port})` : 'Enable remote'}
      </button>
      {info?.error && <p style={{ color: 'var(--nord11)' }}>⚠ Couldn’t start remote: {info.error}</p>}
      {info?.enabled && info.url && (
        <div className="remote-pair">
          {qr && <img src={qr} alt="Scan to pair your phone" />}
          <code className="remote-url">{info.url}</code>
          <button className="link-btn" onClick={() => void refresh()}>
            ↻ New QR code
          </button>
        </div>
      )}
      {info?.enabled && !info.url && (
        <p className="muted small" style={{ padding: 0 }}>
          No LAN address found — connect to a network to get a pairing link.
        </p>
      )}
      {info?.enabled && (
        <details className="remote-advanced">
          <summary>Advanced — Stream Deck / HTTP automation</summary>
          <p className="muted small" style={{ padding: 0 }}>
            Non-browser clients can’t scan a QR. Reveal the raw token and set it as a{' '}
            <code>Bearer</code> token on <code>POST /api/cmd</code>. Treat it like a password.
          </p>
          {token ? (
            <input className="remote-token" readOnly value={token} onFocus={(e) => e.currentTarget.select()} />
          ) : (
            <button onClick={() => void reveal()}>Reveal token</button>
          )}
          <button onClick={() => void reset()}>Reset token (unpair all)</button>
        </details>
      )}
    </div>
  )
}

export function SettingsModal(): JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const bot = useStore((s) => s.bot)
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setToken('')
      void window.api.discord.hasToken().then(setHasToken)
    }
  }, [open])

  if (!open) return null

  async function save(): Promise<void> {
    setSaving(true)
    // The real token never leaves the main process; only write a new one if entered,
    // otherwise just (re)connect with the stored token.
    if (token.trim()) await window.api.discord.setToken(token.trim())
    await window.api.discord.connect()
    setSaving(false)
    setOpen(false)
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Discord Bot Settings</h2>
        <p>
          Paste your bot token from the{' '}
          <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
            Discord Developer Portal
          </a>
          . Enable the bot, invite it to your server, then connect. The token is stored locally on
          this machine only.
        </p>
        <div className="field">
          <label>Bot Token</label>
          <input
            type="password"
            value={token}
            placeholder={hasToken ? '•••••••• saved — type to replace' : 'MTrase…'}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        {bot.state === 'error' && (
          <p style={{ color: 'var(--nord11)' }}>⚠ {bot.error}</p>
        )}
        {bot.state === 'ready' && (
          <p style={{ color: 'var(--nord14)' }}>✓ Connected as {bot.username}</p>
        )}
        <hr className="modal-sep" />
        <RemoteSettings />
        <div className="actions">
          <button onClick={() => setOpen(false)}>Close</button>
          <button
            className="primary"
            disabled={saving || (!token.trim() && !hasToken)}
            onClick={() => void save()}
          >
            {saving ? 'Connecting…' : hasToken && !token.trim() ? 'Connect' : 'Save & Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * First-run welcome + responsibility notice. Doubles as light onboarding: it points
 * out that the local jukebox works with no Discord at all. Acceptance is a UX gate
 * (renderer localStorage), not a security control.
 */
export function DisclaimerModal(): JSX.Element | null {
  const [open, setOpen] = useState(() => localStorage.getItem('qs.disclaimer') !== '1')
  if (!open) return null
  function accept(): void {
    localStorage.setItem('qs.disclaimer', '1')
    setOpen(false)
  }
  return (
    <div className="modal-backdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Welcome to QuestStream</h2>
        <p>
          A bring-your-own-audio mixer for tabletop game masters: build a soundtrack from your
          own files or links, layer ambience and one-shots, snapshot whole scenes, and play it
          to your table.
        </p>
        <p>
          <strong>You don’t need Discord to start</strong> — the local jukebox plays on this
          machine right away. Add a bot token in ⚙ Settings only when you want to stream into a
          voice channel.
        </p>
        <p className="muted small" style={{ padding: 0 }}>
          QuestStream is a player, not a content library. You’re responsible for complying with
          the terms of service of any source you use and with the copyright of the material you
          play; it’s intended for content you own or are licensed to use. Not affiliated with
          YouTube or Discord.
        </p>
        <div className="actions">
          <button className="primary" onClick={accept}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}

const QUICK_TAGS = ['Combat', 'Boss', 'Tavern', 'Travel', 'Town', 'Forest', 'Dungeon', 'Sad', 'Tense', 'Ambient']

export function SongEditModal(): JSX.Element | null {
  const songId = useStore((s) => s.editSongId)
  const setEditSong = useStore((s) => s.setEditSong)
  const library = useStore((s) => s.library)

  const song = library.songs.find((s) => s.id === songId)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [effect, setEffect] = useState('')

  useEffect(() => {
    if (!song) return
    setTitle(song.title)
    setArtist(library.artists.find((a) => a.id === song.artistId)?.name ?? '')
    setAlbum(library.albums.find((a) => a.id === song.albumId)?.title ?? '')
    setTags(song.tags ?? [])
    setTagInput('')
    setEffect(song.effect ?? '')
  }, [songId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) return null

  const addTag = (t: string): void => {
    const v = t.trim()
    if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase())) setTags([...tags, v])
    setTagInput('')
  }

  async function save(): Promise<void> {
    await window.api.library.retag(song!.id, {
      title,
      artistName: artist,
      albumTitle: album,
      tags
    })
    await window.api.library.setEffect(song!.id, effect || null)
    setEditSong(null)
  }

  return (
    <div className="modal-backdrop" onClick={() => setEditSong(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Track</h2>
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Artist</label>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </div>
        <div className="field">
          <label>Album</label>
          <input value={album} onChange={(e) => setAlbum(e.target.value)} />
        </div>
        <div className="field">
          <label>Effect (DSP)</label>
          <select value={effect} onChange={(e) => setEffect(e.target.value)}>
            <option value="">None</option>
            {EFFECT_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Tags</label>
          <div className="tag-edit">
            {tags.map((t) => (
              <span key={t} className="tag-chip active" onClick={() => setTags(tags.filter((x) => x !== t))}>
                {t} ✕
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            placeholder="Add a tag, press Enter"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag(tagInput)
              }
            }}
          />
          <div className="tag-edit quick">
            {QUICK_TAGS.filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase())).map(
              (t) => (
                <span key={t} className="tag-chip" onClick={() => addTag(t)}>
                  + {t}
                </span>
              )
            )}
          </div>
        </div>
        <div className="actions">
          <button onClick={() => setEditSong(null)}>Cancel</button>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export function SaveSceneModal(): JSX.Element | null {
  const open = useStore((s) => s.saveScenePromptOpen)
  const setOpen = useStore((s) => s.setSaveScenePromptOpen)
  const queue = useStore((s) => s.queue)
  const ambience = useStore((s) => s.ambience)
  const scenes = useStore((s) => s.library.scenes)
  const loadedSceneId = useStore((s) => s.loadedSceneId)
  const saveScene = useStore((s) => s.saveScene)
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName(scenes.find((s) => s.id === loadedSceneId)?.name ?? '')
  }, [open, loadedSceneId, scenes])

  if (!open) return null

  async function save(overwrite: boolean): Promise<void> {
    await saveScene(name.trim() || 'Untitled Scene', overwrite ? loadedSceneId ?? undefined : undefined)
    setOpen(false)
  }
  const existing = scenes.find((s) => s.id === loadedSceneId)

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Save as Scene</h2>
        <p>
          Snapshots the whole mix: {queue.length} queued track(s), {ambience.length} ambience
          layer(s), and all volumes. Recall it later in one click.
        </p>
        <div className="field">
          <label>Scene name</label>
          <input
            autoFocus
            value={name}
            placeholder="Tavern brawl"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save(false)}
          />
        </div>
        <div className="actions">
          <button onClick={() => setOpen(false)}>Cancel</button>
          {existing && <button onClick={() => void save(true)}>Update “{existing.name}”</button>}
          <button className="primary" disabled={!name.trim()} onClick={() => void save(false)}>
            Save new
          </button>
        </div>
      </div>
    </div>
  )
}

export function SavePlaylistModal(): JSX.Element | null {
  const open = useStore((s) => s.savePromptOpen)
  const setOpen = useStore((s) => s.setSavePromptOpen)
  const queue = useStore((s) => s.queue)
  const loadedId = useStore((s) => s.loadedPlaylistId)
  const playlists = useStore((s) => s.library.playlists)
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) {
      const existing = playlists.find((p) => p.id === loadedId)
      setName(existing?.name ?? '')
    }
  }, [open, loadedId, playlists])

  if (!open) return null

  async function save(overwrite: boolean): Promise<void> {
    const songIds = queue.map((q) => q.song.id)
    await window.api.playlists.save(name.trim() || 'Untitled Playlist', songIds, overwrite ? loadedId ?? undefined : undefined)
    setOpen(false)
  }

  const existing = playlists.find((p) => p.id === loadedId)

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Save as Playlist</h2>
        <p>{queue.length} tracks will be saved.</p>
        <div className="field">
          <label>Playlist name</label>
          <input
            autoFocus
            value={name}
            placeholder="My mix"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void save(false)}
          />
        </div>
        <div className="actions">
          <button onClick={() => setOpen(false)}>Cancel</button>
          {existing && (
            <button onClick={() => void save(true)}>Update “{existing.name}”</button>
          )}
          <button className="primary" disabled={!name.trim()} onClick={() => void save(false)}>
            Save new
          </button>
        </div>
      </div>
    </div>
  )
}
