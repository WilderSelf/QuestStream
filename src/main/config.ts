import { safeStorage } from 'electron'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

interface ConfigShape {
  discordToken?: string // legacy plaintext (migrated to discordTokenEnc on next save)
  discordTokenEnc?: string // base64 of an OS-encrypted token (safeStorage)
  remoteEnabled?: boolean
  remotePort?: number
  remoteToken?: string // plaintext fallback bearer token
  remoteTokenEnc?: string // base64 of an OS-encrypted bearer token
  cookiesMode?: 'none' | 'file' | 'browser' // yt-dlp cookie source
  cookiesBrowser?: string // browser name when cookiesMode === 'browser'
}

const DEFAULT_REMOTE_PORT = 3333

/**
 * Local settings store. Bearer credentials (the Discord bot token and the remote
 * API token) are encrypted at rest via Electron's `safeStorage` (OS keychain /
 * libsecret / DPAPI) whenever available, falling back to plaintext with a warning.
 * Must be constructed after `app.whenReady()`.
 */
export class Config {
  private token_ = ''
  private remoteEnabled_ = false
  private remotePort_ = DEFAULT_REMOTE_PORT
  private remoteToken_ = ''
  private cookiesMode_: 'none' | 'file' | 'browser' = 'none'
  private cookiesBrowser_ = ''

  constructor(private readonly path: string) {
    const data = this.load()
    this.token_ = data.token
    this.remoteEnabled_ = data.remoteEnabled
    this.remotePort_ = data.remotePort
    this.remoteToken_ = data.remoteToken
    this.cookiesMode_ = data.cookiesMode
    this.cookiesBrowser_ = data.cookiesBrowser
    // Migrate any plaintext credential to encrypted form on startup.
    if (data.legacyPlaintext && safeStorage.isEncryptionAvailable()) this.save()
  }

  private decrypt(enc?: string, plain?: string): { value: string; legacy: boolean } {
    if (enc && safeStorage.isEncryptionAvailable()) {
      try {
        return { value: safeStorage.decryptString(Buffer.from(enc, 'base64')).trim(), legacy: false }
      } catch (err) {
        console.error('[config] could not decrypt a stored credential:', err)
      }
    }
    return { value: (plain ?? '').trim(), legacy: !!plain }
  }

  private load(): {
    token: string
    remoteEnabled: boolean
    remotePort: number
    remoteToken: string
    cookiesMode: 'none' | 'file' | 'browser'
    cookiesBrowser: string
    legacyPlaintext: boolean
  } {
    try {
      if (existsSync(this.path)) {
        const data = JSON.parse(readFileSync(this.path, 'utf8')) as ConfigShape
        const tk = this.decrypt(data.discordTokenEnc, data.discordToken)
        const rt = this.decrypt(data.remoteTokenEnc, data.remoteToken)
        const mode =
          data.cookiesMode === 'file' || data.cookiesMode === 'browser' ? data.cookiesMode : 'none'
        return {
          token: tk.value,
          remoteEnabled: !!data.remoteEnabled,
          remotePort: typeof data.remotePort === 'number' ? data.remotePort : DEFAULT_REMOTE_PORT,
          remoteToken: rt.value,
          cookiesMode: mode,
          cookiesBrowser: typeof data.cookiesBrowser === 'string' ? data.cookiesBrowser : '',
          legacyPlaintext: tk.legacy || rt.legacy
        }
      }
    } catch (err) {
      console.error('[config] load failed:', err)
    }
    return {
      token: '',
      remoteEnabled: false,
      remotePort: DEFAULT_REMOTE_PORT,
      remoteToken: '',
      cookiesMode: 'none',
      cookiesBrowser: '',
      legacyPlaintext: false
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const out: ConfigShape = {
      remoteEnabled: this.remoteEnabled_,
      remotePort: this.remotePort_,
      cookiesMode: this.cookiesMode_,
      cookiesBrowser: this.cookiesBrowser_ || undefined
    }
    const canEncrypt = safeStorage.isEncryptionAvailable()
    if (!canEncrypt && (this.token_ || this.remoteToken_)) {
      console.warn('[config] OS encryption unavailable — storing credential(s) in plaintext')
    }
    if (this.token_) {
      if (canEncrypt) out.discordTokenEnc = safeStorage.encryptString(this.token_).toString('base64')
      else out.discordToken = this.token_
    }
    if (this.remoteToken_) {
      if (canEncrypt) out.remoteTokenEnc = safeStorage.encryptString(this.remoteToken_).toString('base64')
      else out.remoteToken = this.remoteToken_
    }
    writeFileSync(this.path, JSON.stringify(out, null, 2), 'utf8')
  }

  get token(): string {
    return this.token_
  }
  set token(value: string) {
    this.token_ = value.trim()
    this.save()
  }

  get remoteEnabled(): boolean {
    return this.remoteEnabled_
  }
  set remoteEnabled(on: boolean) {
    this.remoteEnabled_ = on
    this.save()
  }

  get remotePort(): number {
    return this.remotePort_
  }

  /** The remote bearer token, generated (and persisted) on first access. */
  get remoteToken(): string {
    if (!this.remoteToken_) {
      this.remoteToken_ = randomBytes(24).toString('base64url')
      this.save()
    }
    return this.remoteToken_
  }

  get cookiesMode(): 'none' | 'file' | 'browser' {
    return this.cookiesMode_
  }
  get cookiesBrowser(): string {
    return this.cookiesBrowser_
  }
  /** Set the yt-dlp cookie source. */
  setCookies(mode: 'none' | 'file' | 'browser', browser = ''): void {
    this.cookiesMode_ = mode
    this.cookiesBrowser_ = mode === 'browser' ? browser : ''
    this.save()
  }

  /** Rotate the remote bearer token (invalidates every paired device). Returns the new one. */
  regenerateRemoteToken(): string {
    this.remoteToken_ = randomBytes(24).toString('base64url')
    this.save()
    return this.remoteToken_
  }
}
