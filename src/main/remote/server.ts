import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import type { RemoteState, RemoteCommand } from '../../shared/types'
import { REMOTE_PAGE } from './page'

/** Constant-time string compare (avoids leaking the token via timing). */
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** First non-internal IPv4 address, for building the phone-facing URL. */
export function lanIp(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return null
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      data += c.toString('utf8')
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const clampNum = (n: unknown, lo: number, hi: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo

/** Validate untrusted JSON into a typed RemoteCommand, or null if not recognized. */
export function parseCommand(raw: unknown): RemoteCommand | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  switch (r.action) {
    case 'togglePlay':
    case 'pause':
    case 'resume':
    case 'next':
    case 'prev':
      return { action: r.action }
    case 'seek':
      return { action: 'seek', seconds: clampNum(r.seconds, 0, 24 * 3600) }
    case 'setVolume':
      return { action: 'setVolume', volume: clampNum(r.volume, 0, 1) }
    case 'duck':
      return { action: 'duck', on: !!r.on }
    case 'recallScene':
      return typeof r.id === 'string' ? { action: 'recallScene', id: r.id } : null
    case 'triggerSfx':
      return typeof r.id === 'string' ? { action: 'triggerSfx', id: r.id } : null
    case 'playQueueItem':
      return typeof r.uid === 'string' ? { action: 'playQueueItem', uid: r.uid } : null
    default:
      return null
  }
}

// ---- pairing handshake ----

export interface PairingState {
  code: string
  expires: number // epoch ms
  used: boolean
}
const PAIRING_TTL_MS = 5 * 60_000

/** A pairing code is valid only if it matches, hasn't expired, and hasn't been used. */
export function validatePairing(state: PairingState | null, code: string, now: number): boolean {
  if (!state || state.used || now > state.expires) return false
  return safeEq(code, state.code)
}

// ---- rate limiting ----

/**
 * A tiny token bucket (deterministic — `now` is injected, so it's unit-testable). Used
 * to bound /api POSTs.
 */
export class RateBucket {
  private tokens: number
  private last: number
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now: number
  ) {
    this.tokens = capacity
    this.last = now
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec)
    this.last = now
    if (this.tokens >= 1) {
      this.tokens -= 1
      return true
    }
    return false
  }
}

/**
 * A tiny LAN HTTP server that lets a phone browser (or a Stream Deck / HTTP automation)
 * control playback. Bound to 0.0.0.0 so the phone can reach it, but every /api call
 * (except the one-time pairing exchange) requires the bearer token in an Authorization
 * header — the token is NEVER placed in a URL/QR. The QR carries a short-lived, single-use
 * pairing code that a *browser* exchanges once for the token; non-browser clients get the
 * token from the desktop Settings → Advanced reveal. There is no TLS, so the token still
 * traverses the LAN in cleartext: trusted networks only. The server holds no audio logic —
 * commands are forwarded (onCommand) to the renderer, which owns the queue/scenes.
 *
 * Rate limiting uses TWO buckets so anti-abuse can't be turned into owner-denial:
 *  - pairBucket: small, BEFORE auth — blunts pairing-code brute force.
 *  - cmdBucket:  larger, AFTER auth — only an authenticated client can consume it, so an
 *               unauthenticated LAN peer cannot starve the legitimate remote's commands.
 */
export class RemoteServer {
  private server: Server | null = null
  private starting = false
  private state: RemoteState | null = null
  private token = ''
  private pairing: PairingState | null = null
  private pairBucket: RateBucket | null = null
  private cmdBucket: RateBucket | null = null
  /** Set by the IPC layer to forward a validated command to the renderer. */
  onCommand: ((cmd: RemoteCommand) => void) | null = null

  constructor(private readonly port: number) {}

  setState(s: RemoteState): void {
    this.state = s
  }

  get running(): boolean {
    return !!this.server
  }

  /** The actual bound port (differs from the requested one when constructed with 0). */
  boundPort(): number | null {
    const addr = this.server?.address()
    return addr && typeof addr === 'object' ? (addr as AddressInfo).port : null
  }

  /** Mint a fresh single-use pairing code (invalidates any prior one). Returns the code. */
  newPairingCode(now: number): string {
    const code = randomBytes(16).toString('base64url')
    this.pairing = { code, expires: now + PAIRING_TTL_MS, used: false }
    return code
  }

  /**
   * Start listening with `token` as the bearer credential. Resolves once listening,
   * rejects on a bind error (e.g. EADDRINUSE) leaving the server stopped.
   */
  start(token: string): Promise<void> {
    if (this.server || this.starting) return Promise.resolve()
    this.starting = true
    this.token = token
    const now = Date.now()
    this.pairBucket = new RateBucket(5, 1, now)
    this.cmdBucket = new RateBucket(40, 20, now)
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res))
      // Slowloris / socket-exhaustion guards.
      server.requestTimeout = 10_000
      server.headersTimeout = 8_000
      server.maxConnections = 32
      const onError = (e: NodeJS.ErrnoException): void => {
        console.error('[remote] server error:', e.message)
        this.server = null
        this.starting = false
        reject(e)
      }
      server.once('error', onError)
      server.listen(this.port, '0.0.0.0', () => {
        server.removeListener('error', onError)
        server.on('error', (e) => console.error('[remote] server error:', e.message))
        console.log(`[remote] listening on 0.0.0.0:${this.boundPortOf(server)}`)
        this.server = server
        this.starting = false
        resolve()
      })
    })
  }

  private boundPortOf(server: Server): number | string {
    const addr = server.address()
    return addr && typeof addr === 'object' ? (addr as AddressInfo).port : this.port
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.pairing = null
  }

  private authed(req: IncomingMessage): boolean {
    const h = (req.headers['authorization'] ?? '').toString().replace(/^Bearer\s+/i, '')
    return !!this.token && safeEq(h, this.token)
  }

  /**
   * DNS-rebinding defense: a real client reaches us by numeric LAN IP, so a Host header
   * carrying a DNS name means a foreign page has rebound its domain to our IP. Accept only
   * IP-literal (or localhost) Host values for /api/ calls.
   */
  private allowedHost(req: IncomingMessage): boolean {
    const name = (req.headers['host'] ?? '')
      .toString()
      .replace(/:\d+$/, '') // strip :port
      .replace(/^\[|\]$/g, '') // strip IPv6 brackets
    if (name === 'localhost') return true
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return true // IPv4 literal
    return name.includes(':') && /^[0-9a-f:]+$/i.test(name) // IPv6 literal
  }

  private json(res: ServerResponse, status: number, body: object): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost')

    // The page itself is public HTML (it carries no secrets); it then exchanges the
    // pairing code from its URL for the bearer token and uses that for /api calls.
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(REMOTE_PAGE)
      return
    }

    if (!url.pathname.startsWith('/api/')) {
      res.writeHead(404)
      res.end()
      return
    }

    if (!this.allowedHost(req)) {
      this.json(res, 403, { error: 'forbidden host' })
      return
    }

    // The one-time pairing exchange is the ONLY endpoint reachable without a bearer; it has
    // its own small bucket (pre-auth) so brute force can't starve authenticated commands.
    if (req.method === 'POST' && url.pathname === '/api/pair') {
      if (!this.pairBucket?.take(Date.now())) {
        this.json(res, 429, { error: 'rate limited' })
        return
      }
      readBody(req, 4 * 1024)
        .then((body) => {
          const code = String((JSON.parse(body || '{}') as { code?: unknown }).code ?? '')
          if (validatePairing(this.pairing, code, Date.now())) {
            if (this.pairing) this.pairing.used = true
            this.json(res, 200, { token: this.token })
          } else {
            this.json(res, 401, { error: 'invalid or expired pairing code' })
          }
        })
        .catch(() => this.json(res, 400, { error: 'bad request' }))
      return
    }

    if (!this.authed(req)) {
      this.json(res, 401, { error: 'unauthorized' })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      this.json(res, 200, this.state ?? {})
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/cmd') {
      // Post-auth bucket: only an authenticated client can consume it.
      if (!this.cmdBucket?.take(Date.now())) {
        this.json(res, 429, { error: 'rate limited' })
        return
      }
      readBody(req, 64 * 1024)
        .then((body) => {
          const cmd = parseCommand(JSON.parse(body || '{}'))
          if (cmd) this.onCommand?.(cmd)
          this.json(res, cmd ? 200 : 400, cmd ? { ok: true } : { error: 'bad command' })
        })
        .catch(() => this.json(res, 400, { error: 'bad request' }))
      return
    }

    res.writeHead(404)
    res.end()
  }
}
