import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { EFFECT_PRESETS } from '@shared/effects'
import type {
  ItemKind,
  RemoteInfo,
  ToolStatus,
  CookiesStatus,
  CookiesMode,
  CookieBrowser,
  DesktopStatus
} from '@shared/types'
import { COOKIE_BROWSERS } from '@shared/types'
import { KIND_ORDER, KIND_LABELS } from '@shared/taxonomy'
import { useStore } from '../store'
import { Modal } from './Modal'
import { TagPicker } from './ImportWizard'

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
      <h3 className="field-label">Phone / Stream Deck remote</h3>
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

const TOOL_SOURCE_LABEL: Record<ToolStatus['source'], string> = {
  downloaded: 'updated copy',
  bundled: 'bundled with app',
  system: 'found on system',
  none: 'not found'
}

function ToolsSettings(): JSX.Element {
  const [status, setStatus] = useState<ToolStatus[] | null>(null)
  const updateYtdlp = useStore((s) => s.updateYtdlp)
  const updating = useStore((s) => s.updatingYtdlp)

  const refresh = (): void => void window.api.tools.getStatus().then(setStatus)
  useEffect(() => {
    refresh()
  }, [])
  // Re-read status when an update finishes (so the source flips to "updated copy").
  useEffect(() => {
    if (!updating) refresh()
  }, [updating])

  return (
    <div className="field">
      <h3 className="field-label">Playback tools</h3>
      <p className="muted small" style={{ padding: 0 }}>
        QuestStream uses <code>yt-dlp</code> + <code>ffmpeg</code> to fetch and decode audio. They
        ship with the app, but YouTube changes often break a frozen <code>yt-dlp</code> — update it
        here if links stop playing.
      </p>
      <ul className="tool-list">
        {status?.map((t) => (
          <li key={t.name} className={t.found ? '' : 'missing'}>
            <span className="tool-name">{t.name}</span>
            <span className="tool-source">{t.found ? TOOL_SOURCE_LABEL[t.source] : 'not found'}</span>
            <span className={`tool-dot ${t.found ? 'ok' : 'bad'}`} aria-hidden="true" />
          </li>
        ))}
      </ul>
      <button disabled={updating} onClick={() => void updateYtdlp()}>
        {updating ? 'Updating yt-dlp…' : 'Update yt-dlp'}
      </button>
    </div>
  )
}

function CookiesSettings(): JSX.Element {
  const [status, setStatus] = useState<CookiesStatus | null>(null)
  const showNotice = useStore((s) => s.showNotice)

  useEffect(() => {
    void window.api.cookies.get().then(setStatus)
  }, [])

  async function setMode(mode: CookiesMode, browser?: CookieBrowser): Promise<void> {
    setStatus(await window.api.cookies.setMode(mode, browser))
  }
  async function importFile(): Promise<void> {
    const r = await window.api.cookies.importFile()
    if (!r.ok) showNotice(r.error ?? 'Could not import cookies', 'error')
    else if (r.status) {
      setStatus(r.status)
      showNotice('Cookies imported — YouTube links should work now.', 'info')
    }
  }

  const mode = status?.mode ?? 'none'

  return (
    <div className="field">
      <h3 className="field-label">YouTube cookies</h3>
      <p className="muted small" style={{ padding: 0 }}>
        If YouTube asks you to “confirm you’re not a bot”, give yt-dlp your cookies so it looks like
        your signed-in browser. Use a cookies file (works everywhere, incl. the Flatpak) or read them
        straight from a browser (only when running unsandboxed).
      </p>
      <div className="kind-tabs">
        <button
          className={`seg ${mode === 'none' ? 'active' : ''}`}
          aria-pressed={mode === 'none'}
          onClick={() => void setMode('none')}
        >
          Off
        </button>
        <button
          className={`seg ${mode === 'file' ? 'active' : ''}`}
          aria-pressed={mode === 'file'}
          onClick={() => void setMode('file')}
        >
          Cookies file
        </button>
        <button
          className={`seg ${mode === 'browser' ? 'active' : ''}`}
          aria-pressed={mode === 'browser'}
          onClick={() => void setMode('browser', status?.browser ?? 'firefox')}
        >
          From browser
        </button>
      </div>

      {mode === 'file' && (
        <div className="cookies-row">
          <button onClick={() => void importFile()}>Choose cookies.txt…</button>
          <span className={`muted small ${status?.hasFile ? 'ok' : ''}`} style={{ padding: 0 }}>
            {status?.hasFile ? '✓ cookies file loaded' : 'No file imported yet'}
          </span>
        </div>
      )}
      {mode === 'browser' && (
        <div className="cookies-row">
          <select
            value={status?.browser ?? 'firefox'}
            aria-label="Browser to read cookies from"
            onChange={(e) => void setMode('browser', e.target.value as CookieBrowser)}
          >
            {COOKIE_BROWSERS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <span className="muted small" style={{ padding: 0 }}>
            Reads cookies from this browser’s profile. Won’t work inside the Flatpak sandbox — use a
            cookies file there.
          </span>
        </div>
      )}
    </div>
  )
}

function DesktopIntegrationSettings(): JSX.Element | null {
  const [status, setStatus] = useState<DesktopStatus | null>(null)
  const showNotice = useStore((s) => s.showNotice)
  const installDesktopMenu = useStore((s) => s.installDesktopMenu)

  useEffect(() => {
    void window.api.desktop.getStatus().then(setStatus)
  }, [])

  // Only meaningful for an AppImage (other packages register their own launcher).
  if (!status?.isAppImage) return null

  async function add(): Promise<void> {
    const r = await installDesktopMenu()
    if (r.ok && r.status) setStatus(r.status)
  }

  return (
    <>
      <hr className="modal-sep" />
      <div className="field">
        <h3 className="field-label">Applications menu</h3>
        <p className="muted small" style={{ padding: 0 }}>
          You’re running the AppImage. Add a launcher so QuestStream appears in your applications
          menu like a normal app.
        </p>
        <div className="cookies-row">
          {status.installed ? (
            <span className="muted small ok" style={{ padding: 0 }}>
              ✓ Installed in your applications menu
            </span>
          ) : (
            <button onClick={() => void add()}>Add to applications menu</button>
          )}
          <button
            onClick={() => {
              void window.api.update.check()
              showNotice('Checking for updates…', 'info')
            }}
          >
            Check for updates
          </button>
        </div>
      </div>
    </>
  )
}

function OutputDeviceSettings(): JSX.Element {
  const outputDeviceId = useStore((s) => s.outputDeviceId)
  const setOutputDevice = useStore((s) => s.setOutputDevice)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    let cancelled = false
    // Device labels are blank until media permission is granted; main grants it silently
    // (see setupMediaPermissions in src/main/index.ts) so real names show with no prompt.
    const refresh = async (): Promise<void> => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'audiooutput'))
      } catch {
        /* enumeration unavailable — leave the list empty (System default still works) */
      }
    }
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
    }
  }, [])

  return (
    <>
      <hr className="modal-sep" />
      <div className="field">
        <h3 className="field-label">Local output device</h3>
        <p className="muted small" style={{ padding: 0 }}>
          Which speakers or headphones the local monitor plays to. Only affects local playback —
          Discord streaming always uses the bot’s voice connection.
        </p>
        <div className="cookies-row">
          <select
            value={outputDeviceId}
            aria-label="Local audio output device"
            onChange={(e) => setOutputDevice(e.target.value)}
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Output ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
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
    <Modal onClose={() => setOpen(false)} className="settings" labelledBy="settings-title">
        <h2 id="settings-title">Discord Bot Settings</h2>
        <p>
          Paste your bot token from the{' '}
          <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
            Discord Developer Portal
          </a>
          . Enable the bot, invite it to your server, then connect. The token is stored locally on
          this machine only.
        </p>
        <div className="field">
          <label htmlFor="bot-token">Bot Token</label>
          <input
            id="bot-token"
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
        <DesktopIntegrationSettings />
        <OutputDeviceSettings />
        <details className="settings-advanced">
          <summary>Advanced — playback tools, YouTube cookies, remote</summary>
          <div className="settings-advanced-body">
            <ToolsSettings />
            <hr className="modal-sep" />
            <CookiesSettings />
            <hr className="modal-sep" />
            <RemoteSettings />
          </div>
        </details>
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
    </Modal>
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
    <Modal onClose={accept} dismissable={false} labelledBy="disclaimer-title">
        <h2 id="disclaimer-title">Welcome to QuestStream</h2>
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
    </Modal>
  )
}

export function SongEditModal(): JSX.Element | null {
  const songId = useStore((s) => s.editSongId)
  const setEditSong = useStore((s) => s.setEditSong)
  const library = useStore((s) => s.library)

  const song = library.songs.find((s) => s.id === songId)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [kind, setKind] = useState<ItemKind>('track')
  const [effect, setEffect] = useState('')

  useEffect(() => {
    if (!song) return
    setTitle(song.title)
    setArtist(library.artists.find((a) => a.id === song.artistId)?.name ?? '')
    setAlbum(library.albums.find((a) => a.id === song.albumId)?.title ?? '')
    setTags(song.tags ?? [])
    setKind(song.kind ?? 'track')
    setEffect(song.effect ?? '')
  }, [songId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) return null

  async function save(): Promise<void> {
    await window.api.library.retag(song!.id, {
      title,
      artistName: artist,
      albumTitle: album,
      tags,
      kind
    })
    await window.api.library.setEffect(song!.id, effect || null)
    setEditSong(null)
  }

  return (
    <Modal onClose={() => setEditSong(null)} labelledBy="songedit-title">
        <h2 id="songedit-title">Edit item</h2>
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-artist">Artist</label>
          <input id="edit-artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-album">Album</label>
          <input id="edit-album" value={album} onChange={(e) => setAlbum(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-effect">Effect (DSP)</label>
          <select id="edit-effect" value={effect} onChange={(e) => setEffect(e.target.value)}>
            <option value="">None</option>
            {EFFECT_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <div className="field-label">Type</div>
          <div className="kind-tabs">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                className={`seg ${kind === k ? 'active' : ''}`}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <div className="field-label">Tags</div>
          <TagPicker kind={kind} value={tags} onChange={setTags} />
        </div>
        <div className="actions">
          <button onClick={() => setEditSong(null)}>Cancel</button>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
        </div>
    </Modal>
  )
}

/**
 * Shared "save the current mix as a named X" dialog. Owns the name field; the caller
 * supplies the copy, the seed name (for re-saving over a loaded entity), and the save
 * action (which applies its own empty-name fallback). The "Update …" button only shows
 * when there's an entity to overwrite.
 */
function SaveAsModal(props: {
  title: string
  description: string
  label: string
  placeholder: string
  seedName: string
  existingName?: string
  onClose: () => void
  onSave: (name: string, overwrite: boolean) => void
}): JSX.Element {
  const { title, description, label, placeholder, seedName, existingName, onClose, onSave } = props
  const [name, setName] = useState(seedName)
  useEffect(() => setName(seedName), [seedName]) // re-seed if the loaded entity changes

  return (
    <Modal onClose={onClose} labelledBy="saveas-title">
        <h2 id="saveas-title">{title}</h2>
        <p>{description}</p>
        <div className="field">
          <label htmlFor="saveas-name">{label}</label>
          <input
            id="saveas-name"
            autoFocus
            value={name}
            placeholder={placeholder}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSave(name, false)}
          />
        </div>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          {existingName && <button onClick={() => onSave(name, true)}>Update “{existingName}”</button>}
          <button className="primary" disabled={!name.trim()} onClick={() => onSave(name, false)}>
            Save new
          </button>
        </div>
    </Modal>
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

  if (!open) return null
  const existing = scenes.find((s) => s.id === loadedSceneId)

  return (
    <SaveAsModal
      title="Save as Scene"
      description={`Snapshots the whole mix: ${queue.length} queued track(s), ${ambience.length} ambience layer(s), and all volumes. Recall it later in one click.`}
      label="Scene name"
      placeholder="Tavern brawl"
      seedName={existing?.name ?? ''}
      existingName={existing?.name}
      onClose={() => setOpen(false)}
      onSave={(name, overwrite) => {
        void saveScene(name.trim() || 'Untitled Scene', overwrite ? loadedSceneId ?? undefined : undefined)
        setOpen(false)
      }}
    />
  )
}

export function SavePlaylistModal(): JSX.Element | null {
  const open = useStore((s) => s.savePromptOpen)
  const setOpen = useStore((s) => s.setSavePromptOpen)
  const queue = useStore((s) => s.queue)
  const loadedId = useStore((s) => s.loadedPlaylistId)
  const playlists = useStore((s) => s.library.playlists)

  if (!open) return null
  const existing = playlists.find((p) => p.id === loadedId)

  return (
    <SaveAsModal
      title="Save as Playlist"
      description={`${queue.length} tracks will be saved.`}
      label="Playlist name"
      placeholder="My mix"
      seedName={existing?.name ?? ''}
      existingName={existing?.name}
      onClose={() => setOpen(false)}
      onSave={(name, overwrite) => {
        const songIds = queue.map((q) => q.song.id)
        void window.api.playlists.save(
          name.trim() || 'Untitled Playlist',
          songIds,
          overwrite ? loadedId ?? undefined : undefined
        )
        setOpen(false)
      }}
    />
  )
}
