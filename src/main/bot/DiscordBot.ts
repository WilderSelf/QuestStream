import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { isInMediaDir } from '../library/media'
import { Client, GatewayIntentBits, ChannelType } from 'discord.js'
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  generateDependencyReport,
  type VoiceConnection,
  type AudioPlayer,
  type AudioResource
} from '@discordjs/voice'
import { Mixer, FRAME_BYTES, clamp01 } from './Mixer'
import { pickNextDelay, pickFromPool } from './random'
import type {
  GuildInfo,
  VoiceChannelInfo,
  BotStatus,
  PlayerStatus,
  AmbienceLayerStatus,
  Song,
  AppNotice
} from '../../shared/types'
import { DEFAULT_VOLUME } from '../../shared/constants'

export declare interface DiscordBot {
  on(event: 'botStatus', l: (s: BotStatus) => void): this
  on(event: 'playerStatus', l: (s: PlayerStatus) => void): this
  on(event: 'ended', l: (songId: string) => void): this
  on(event: 'ambienceStatus', l: (layers: AmbienceLayerStatus[]) => void): this
  on(event: 'monitorPcm', l: (pcm: Buffer) => void): this
  on(event: 'notice', l: (n: AppNotice) => void): this
}

interface RandomLayer {
  songs: Song[]
  volume: number
  minSec: number
  maxSec: number
  paused: boolean
  timer: NodeJS.Timeout | null
  counter: number
  activeShots: Set<string>
  delayMs: number // the currently-scheduled interval until the next shot
  nextFireAt: number // Date.now() timestamp the next shot is due (drives the countdown bar)
}

// Cap how many one-shots a single random layer may have playing at once, so a short
// interval over long clips can't spawn an unbounded pile of ffmpeg/yt-dlp processes.
const MAX_CONCURRENT_RANDOM_SHOTS = 4

export class DiscordBot extends EventEmitter {
  private client: Client | null = null
  private connection: VoiceConnection | null = null
  private player: AudioPlayer
  private resource: AudioResource | null = null
  private readonly mixer = new Mixer()
  private mixSource: Readable | null = null

  private status: BotStatus = { state: 'disconnected' }
  private daveChecked = false // DAVE/E2EE dependency self-check runs once
  private volume = DEFAULT_VOLUME
  private musicVolume = 1
  private currentSong: Song | null = null
  private currentMusicId: string | null = null
  private musicCounter = 0
  private musicPaused = false
  private musicBuffering = false // true between play() of a cold track and its first PCM
  private prefetched: { videoId: string; id: string } | null = null
  private crossfadeMs = 2500
  private nearEndFired = false
  private statusTimer: NodeJS.Timeout | null = null
  private monitor = false
  private monitorBatch: Buffer[] = []
  private sfxCounter = 0
  // Ducking is reference-counted: each playing one-shot (and the manual narration
  // toggle) is a "holder". Music drops while ≥1 holder is active, restores at zero.
  private duckHolders = new Set<string>()
  private readonly duckLevel = 0.3
  private readonly duckRampMs = 400
  // Randomized ambience layers (organic one-shots). The timer only *triggers* shots —
  // it does NOT drive mixer frames (that's the AudioPlayer's job; see §5.3). Driving
  // frames off a timer is the forbidden thing; scheduling a trigger is fine.
  private randomLayers = new Map<string, RandomLayer>()
  // Slot ids of the looping ambience layers, so the heartbeat can report each one's
  // loop position (the mixer input is keyed `amb:<slotId>`).
  private loopSlots = new Set<string>()

  /** @param mediaDir absolute path of the app's local-media folder; local songs must live under it. */
  constructor(private readonly mediaDir: string) {
    super()
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    })
    this.wirePlayer()
    this.startMix() // player runs continuously (its realtime clock drives the mixer)
  }

  /**
   * Feed the mixer to the AudioPlayer once, for the app's lifetime. With
   * NoSubscriberBehavior.Play the player keeps pulling frames at a precise 20ms
   * cadence even with no voice connection — so it drives both the local jukebox/
   * monitor AND Discord (when a connection is subscribed), using one stable clock.
   */
  private startMix(): void {
    const source = new Readable({
      highWaterMark: FRAME_BYTES,
      read: () => {
        source.push(this.mixer.produceFrame())
      }
    })
    const resource = createAudioResource(source, {
      inputType: StreamType.Raw,
      inlineVolume: true
    })
    resource.volume?.setVolume(this.volume)
    this.mixSource = source
    this.resource = resource
    this.player.play(resource)
  }

  // ---------------------------------------------------------------- connection

  /**
   * Discord enforces the DAVE end-to-end-encryption protocol on all non-stage voice calls
   * (since 2026-03-01); a client that can't do DAVE is rejected with voice close code 4017.
   * The capability is delegated to @discordjs/voice ≥0.19 + a loadable @snazzah/davey native
   * binary — but in a packaged build that native .node can fail to unpack, which would only
   * surface as a cryptic mid-session join failure. Verify once at connect time and raise a
   * persistent banner up front instead. Logs the full report either way for diagnostics.
   */
  private verifyDaveSupport(): void {
    if (this.daveChecked) return
    this.daveChecked = true
    let report = ''
    try {
      report = generateDependencyReport()
    } catch (err) {
      console.error('[voice] dependency report failed:', (err as Error).message)
    }
    console.log('[voice] @discordjs/voice dependency report:\n' + report)
    const hasDave = /DAVE Libraries[\s\S]*@snazzah\/davey:\s*\d/.test(report)
    if (!hasDave) {
      this.emit('notice', {
        message:
          'Discord voice encryption (DAVE / @snazzah/davey) is missing — voice will be rejected ' +
          '(close code 4017). Reinstall QuestStream or rebuild so the native library is bundled.',
        kind: 'error',
        persistent: true // a missing library is a standing condition, not a passing event
      })
    }
  }

  async connect(token: string): Promise<BotStatus> {
    this.verifyDaveSupport() // surface a missing DAVE/E2EE library before a join can 4017
    if (!token) {
      this.setStatus({ state: 'error', error: 'No bot token configured' })
      return this.status
    }
    await this.disconnect()

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    })
    this.client = client
    this.setStatus({ state: 'connecting' })

    // discord.js emits transient ws 'error's it usually auto-recovers from. Don't let
    // one knock a working (ready) bot back to 'error' — that hides the whole guild/
    // channel UI for nothing. Always log; only surface as an error if we weren't
    // connected yet (i.e. the failure is during connect/login).
    client.on('error', (e) => {
      console.error('[discord] client error:', e.message)
      if (this.status.state !== 'ready') this.setStatus({ state: 'error', error: e.message })
    })
    // 'invalidated' is the genuinely fatal case (token revoked / forced logout) — the
    // client is unusable after this, so surface it clearly regardless of prior state.
    client.on('invalidated', () => {
      this.setStatus({ state: 'error', error: 'Discord session invalidated — re-check the bot token.' })
    })

    try {
      await client.login(token)
      await new Promise<void>((resolve) => {
        if (client.isReady()) resolve()
        else client.once('clientReady', () => resolve())
      })
      this.setStatus({ state: 'ready', username: client.user?.tag })
    } catch (err) {
      this.setStatus({ state: 'error', error: (err as Error).message })
    }
    return this.status
  }

  async disconnect(): Promise<void> {
    this.safeDestroy(this.connection) // unsubscribes; the mixer/player keep running locally
    this.connection = null
    if (this.client) {
      await this.client.destroy()
      this.client = null
    }
    // Clear the active channel/guild too — otherwise setStatus merges them forward and
    // the UI keeps claiming we're in a voice channel (and the local monitor stays off)
    // after e.g. re-saving the token while joined. Mirrors leave().
    this.setStatus({ state: 'disconnected', activeGuildId: undefined, activeChannelId: undefined })
  }

  getStatus(): BotStatus {
    return this.status
  }

  /** Destroy a voice connection without throwing if it's already destroyed. */
  private safeDestroy(conn: VoiceConnection | null): void {
    if (!conn) return
    try {
      if (conn.state.status !== VoiceConnectionStatus.Destroyed) conn.destroy()
    } catch (err) {
      console.error('[voice] destroy failed:', (err as Error).message)
    }
  }

  private setStatus(patch: Partial<BotStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('botStatus', this.status)
  }

  // ---------------------------------------------------------------- discovery

  getGuilds(): GuildInfo[] {
    if (!this.client) return []
    return [...this.client.guilds.cache.values()].map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64 }) ?? undefined
    }))
  }

  getVoiceChannels(guildId: string): VoiceChannelInfo[] {
    const guild = this.client?.guilds.cache.get(guildId)
    if (!guild) return []
    return [...guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
      .map((c) => ({ id: c.id, name: c.name, guildId }))
  }

  // ---------------------------------------------------------------- voice join

  async join(guildId: string, channelId: string): Promise<void> {
    const guild = this.client?.guilds.cache.get(guildId)
    if (!guild) throw new Error('Guild not found — is the bot in that server?')

    // Pre-flight: verify the bot can actually connect to this channel. Missing
    // Connect/View permission is the #1 cause of a join hanging in 'signalling'.
    const channel = guild.channels.cache.get(channelId)
    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null))
    if (channel && me && 'permissionsFor' in channel) {
      const perms = channel.permissionsFor(me)
      const missing: string[] = []
      if (!perms?.has('ViewChannel')) missing.push('View Channel')
      if (!perms?.has('Connect')) missing.push('Connect')
      if (!perms?.has('Speak')) missing.push('Speak')
      if (missing.length) {
        throw new Error(
          `The bot is missing the ${missing.join(' + ')} permission on “${channel.name}”. ` +
            `Re-invite it with those permissions, or fix that channel's permission overrides.`
        )
      }
    }

    this.safeDestroy(this.connection)
    const connection = joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    })
    this.connection = connection

    connection.on('stateChange', (oldS, newS) => {
      console.log(`[voice] ${oldS.status} -> ${newS.status}`)
      // Surface the raw WS close code (helps diagnose future voice-gateway issues).
      const nw = (newS as { networking?: { __tapped?: boolean } & NodeJS.EventEmitter }).networking
      if (nw && !nw.__tapped) {
        nw.__tapped = true
        nw.on('close', (code: number) => console.log('[voice] WS closed, code:', code))
      }
    })
    connection.on('error', (e) => console.error('[voice] connection error:', e.message))

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
    } catch {
      const last = connection.state.status
      this.safeDestroy(connection)
      this.connection = null
      let hint = ''
      if (last === VoiceConnectionStatus.Signalling) {
        hint =
          ' — stuck waiting for a voice server. Usually the bot lacks Connect permission on this channel, the channel is full, or the wrong voice region.'
      } else if (last === VoiceConnectionStatus.Connecting) {
        hint =
          ' — reached the voice server but the UDP audio handshake failed. Check for a VPN/firewall blocking UDP, or a restrictive NAT.'
      }
      throw new Error(`Failed to join within 20s (stalled at: ${last})${hint}`)
    }

    // Standard reconnection recipe: try to recover from transient disconnects
    // (e.g. the bot is moved between channels) before tearing down.
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
        ])
      } catch {
        this.safeDestroy(connection)
      }
    })

    connection.subscribe(this.player) // route the already-running mix to Discord
    this.setStatus({ activeGuildId: guildId, activeChannelId: channelId })
  }

  leave(): void {
    this.safeDestroy(this.connection) // unsubscribe; playback continues locally (jukebox/monitor)
    this.connection = null
    this.setStatus({ activeGuildId: undefined, activeChannelId: undefined })
  }

  // ---------------------------------------------------------------- playback

  private wirePlayer(): void {
    this.player.on('error', (err) => console.error('[player] error:', err.message))
    // Poll position / near-end on a heartbeat.
    this.statusTimer = setInterval(() => this.tick(), 500)
  }

  /**
   * Buffer a track in the background (paused, silent) so a later play() of it is
   * instant. The big start delay is yt-dlp's ~3s resolve; doing it ahead hides it.
   */
  prefetch(song: Song): void {
    if (!song?.videoId || !this.playable(song)) return
    if (song.sourceType === 'local') return // local start is already instant — no warm-up needed
    if (this.prefetched?.videoId === song.videoId) return // already warming this one
    if (this.currentSong?.videoId === song.videoId) return // already playing it
    this.clearPrefetch()
    const id = `prefetch:${++this.musicCounter}`
    const input = this.mixer.addInput(id, song, {
      gain: 0,
      loop: false,
      // A speculative prefetch that fails just drops the warm-up — no user-facing error.
      onError: () => {
        if (this.prefetched?.id === id) this.prefetched = null
      }
    })
    input.paused = true // buffer to the high-water mark without being mixed
    this.prefetched = { videoId: song.videoId, id }
  }

  private clearPrefetch(): void {
    if (this.prefetched) {
      this.mixer.removeInput(this.prefetched.id, 0)
      this.prefetched = null
    }
  }

  /**
   * Defense-in-depth: a non-local song may only ever be an http(s) URL handed to
   * yt-dlp (no file://, no flag-like). A local song must be an absolute path that
   * resolves *inside* the app's media dir — blocking path-traversal to arbitrary files.
   */
  private playable(song: Song | null | undefined): song is Song {
    if (!song?.url) return false
    if (song.sourceType === 'local') return isInMediaDir(this.mediaDir, song.url)
    return /^https?:\/\//i.test(song.url)
  }

  /** Play a song on the music channel, crossfading from whatever was playing. */
  async play(song: Song, seekSec = 0): Promise<void> {
    if (!this.playable(song)) {
      this.emit('notice', { message: 'Refusing to play a track with an invalid URL.', kind: 'error' })
      return
    }
    const immediate = seekSec > 0
    const fade = immediate ? 0 : this.crossfadeMs

    // Adopt a matching prefetched input (already buffered → instant start).
    const warm =
      !immediate && this.prefetched?.videoId === song.videoId
        ? this.mixer.getInput(this.prefetched.id)
        : null

    if (this.currentMusicId) this.mixer.removeInput(this.currentMusicId, fade)

    let id: string
    if (warm) {
      id = this.prefetched!.id
      this.prefetched = null
      warm.onEnd = () => this.handleMusicEnd(id, song.id)
      warm.onError = (reason) => this.handleMusicError(id, song.id, reason)
      warm.paused = false
      warm.setGain(this.musicVolume, fade)
    } else {
      this.clearPrefetch() // playing something else → drop the stale warm-up
      id = `music:${++this.musicCounter}`
      this.mixer.addInput(id, song, {
        gain: this.musicVolume,
        fadeInMs: fade,
        seekSec,
        loop: false,
        onEnd: () => this.handleMusicEnd(id, song.id),
        onError: (reason) => this.handleMusicError(id, song.id, reason)
      })
    }

    this.currentMusicId = id
    this.currentSong = song
    this.nearEndFired = false
    this.musicPaused = false
    if (this.ducked) this.applyMusicGain(fade) // a narration duck spanning a track change stays applied
    // A prefetched track is already buffered → instant. A cold one takes ~3s to first
    // PCM (yt-dlp resolve); report 'buffering' until audio actually flows (see tick()).
    this.musicBuffering = !warm
    this.emitPlayerStatus(this.musicBuffering ? 'buffering' : 'playing')
    console.log(`[player] ${this.musicBuffering ? 'buffering' : 'playing'}${warm ? ' (prefetched)' : ''}: ${song.title}`)
  }

  // Pause/resume the MUSIC channel only — ambience layers keep playing.
  pause(): void {
    if (this.currentMusicId) this.mixer?.setPaused(this.currentMusicId, true)
    this.musicPaused = true
    this.emitPlayerStatus('paused')
  }

  resume(): void {
    if (this.currentMusicId) this.mixer?.setPaused(this.currentMusicId, false)
    this.musicPaused = false
    this.emitPlayerStatus() // mapState() → 'buffering' if audio hasn't started yet, else 'playing'
  }

  stop(): void {
    if (this.currentMusicId) this.mixer?.removeInput(this.currentMusicId, 300)
    this.clearPrefetch()
    this.currentMusicId = null
    this.currentSong = null
    this.nearEndFired = false
    this.musicPaused = false
    this.musicBuffering = false
    this.emitPlayerStatus('idle')
  }

  async seek(seconds: number): Promise<void> {
    if (this.currentSong) await this.play(this.currentSong, Math.max(0, seconds))
  }

  /** Master volume for the whole mix (per-track balance is handled in the mixer). */
  setVolume(volume: number): void {
    this.volume = clamp01(volume)
    this.resource?.volume?.setVolume(this.volume)
    this.emitPlayerStatus()
  }

  /** Volume of the music channel relative to ambience layers. */
  setMusicVolume(volume: number): void {
    this.musicVolume = clamp01(volume)
    this.applyMusicGain(120)
  }

  // ---- soundboard one-shots + ducking ----

  /** Fire a one-shot SFX over the mix (no loop, auto-reaped at its natural end). */
  playOneShot(song: Song, gain = 1, duckUnderMusic = false): void {
    if (!this.playable(song)) {
      this.emit('notice', { message: 'Refusing to play a sound with an invalid source.', kind: 'error' })
      return
    }
    const id = `sfx:${++this.sfxCounter}`
    if (duckUnderMusic) this.addDuck(id)
    this.mixer.addInput(id, song, {
      gain: clamp01(gain),
      loop: false,
      onEnd: () => this.removeDuck(id),
      onError: (reason) => {
        this.removeDuck(id)
        this.emit('notice', { message: `Sound “${song.title}” failed: ${reason}`, kind: 'error', code: 'playback-failed' })
      }
    })
  }

  /** Manual "narration" duck: hold the music down while the GM talks. */
  duck(on: boolean): void {
    if (on) this.addDuck('manual')
    else this.removeDuck('manual')
  }

  private get ducked(): boolean {
    return this.duckHolders.size > 0
  }

  private addDuck(holder: string): void {
    const was = this.ducked
    this.duckHolders.add(holder)
    if (!was) this.applyMusicGain()
  }

  private removeDuck(holder: string): void {
    if (this.duckHolders.delete(holder) && !this.ducked) this.applyMusicGain()
  }

  /** Set the current music input's gain to its volume, attenuated while ducked. */
  private applyMusicGain(rampMs = this.duckRampMs): void {
    if (!this.currentMusicId) return
    const g = this.musicVolume * (this.ducked ? this.duckLevel : 1)
    this.mixer.setGain(this.currentMusicId, g, rampMs)
  }

  // ---- ambience layers (looping) ----

  playAmbience(slotId: string, song: Song, volume: number): void {
    if (!this.playable(song)) {
      this.emit('notice', { message: 'Refusing to loop a layer with an invalid URL.', kind: 'error' })
      return
    }
    this.clearRandomLayer(slotId) // switching a slot from random → loop
    this.loopSlots.add(slotId)
    this.mixer.addInput(`amb:${slotId}`, song, {
      gain: clamp01(volume),
      fadeInMs: 800,
      loop: true,
      onError: (reason) =>
        this.emit('notice', { message: `Ambience “${song.title}” failed: ${reason}`, kind: 'error', code: 'playback-failed' })
    })
  }

  setAmbienceVolume(slotId: string, volume: number): void {
    this.mixer.setGain(`amb:${slotId}`, clamp01(volume), 150)
    const layer = this.randomLayers.get(slotId)
    if (layer) layer.volume = clamp01(volume) // future shots; in-flight ones keep theirs
  }

  setAmbiencePaused(slotId: string, paused: boolean): void {
    this.mixer.setPaused(`amb:${slotId}`, paused)
    const layer = this.randomLayers.get(slotId)
    if (layer) {
      layer.paused = paused
      if (paused) this.cancelRandomTimer(layer)
      else if (!layer.timer) this.scheduleRandom(slotId) // resume scheduling
    }
  }

  stopAmbience(slotId: string): void {
    this.mixer?.removeInput(`amb:${slotId}`, 600)
    this.loopSlots.delete(slotId)
    this.clearRandomLayer(slotId)
  }

  // ---- randomized ambience (organic one-shots) ----

  /**
   * Start (or restart) a "random" layer: every [minSec, maxSec] a random track from
   * `songs` fires once over the mix. The scheduler timer only triggers shots — it
   * never drives mixer frames (gotcha §5.3 is about frame production, not triggers).
   */
  playRandomAmbience(slotId: string, songs: Song[], volume: number, minSec: number, maxSec: number): void {
    const playable = songs.filter((s) => this.playable(s))
    if (playable.length === 0) {
      this.emit('notice', { message: 'Random layer has no playable sounds.', kind: 'error' })
      return
    }
    this.mixer.removeInput(`amb:${slotId}`, 200) // a slot is either loop OR random, never both
    this.loopSlots.delete(slotId)
    this.clearRandomLayer(slotId)
    this.randomLayers.set(slotId, {
      songs: playable,
      volume: clamp01(volume),
      minSec,
      maxSec,
      paused: false,
      timer: null,
      counter: 0,
      activeShots: new Set(),
      delayMs: 0,
      nextFireAt: 0
    })
    this.scheduleRandom(slotId)
  }

  private scheduleRandom(slotId: string): void {
    const layer = this.randomLayers.get(slotId)
    if (!layer || layer.paused) return
    const delay = pickNextDelay(layer.minSec, layer.maxSec)
    layer.delayMs = delay
    layer.nextFireAt = Date.now() + delay
    layer.timer = setTimeout(() => {
      const l = this.randomLayers.get(slotId)
      if (!l || l.paused) return
      // Skip this tick (but keep scheduling) if too many shots are still playing.
      const song = l.activeShots.size >= MAX_CONCURRENT_RANDOM_SHOTS ? null : pickFromPool(l.songs)
      if (song) {
        const shotId = `ambshot:${slotId}:${++l.counter}`
        l.activeShots.add(shotId)
        this.mixer.addInput(shotId, song, {
          gain: l.volume,
          loop: false,
          onEnd: () => l.activeShots.delete(shotId),
          onError: () => l.activeShots.delete(shotId)
        })
      }
      this.scheduleRandom(slotId) // queue the next shot
    }, delay)
  }

  private cancelRandomTimer(layer: RandomLayer): void {
    if (layer.timer) {
      clearTimeout(layer.timer)
      layer.timer = null
    }
  }

  private clearRandomLayer(slotId: string): void {
    const layer = this.randomLayers.get(slotId)
    if (!layer) return
    this.cancelRandomTimer(layer)
    for (const shotId of layer.activeShots) this.mixer.removeInput(shotId, 300)
    this.randomLayers.delete(slotId)
  }

  // ---- local monitoring (play the mix on the host's own speakers) ----

  /** Enable/disable forwarding the mixed PCM to the renderer for local playback. */
  setMonitor(enabled: boolean): void {
    this.monitor = enabled
    if (enabled) this.attachMonitor()
    else {
      this.mixer.onFrame = null
      this.monitorBatch = []
    }
  }

  private attachMonitor(): void {
    this.mixer.onFrame = (frame) => {
      this.monitorBatch.push(frame)
      if (this.monitorBatch.length >= 2) {
        // ~40ms of PCM per IPC message → smooth delivery without being too chatty
        this.emit('monitorPcm', Buffer.concat(this.monitorBatch))
        this.monitorBatch = []
      }
    }
  }

  /** A music track failed to stream (hang / dead / blocked). Notify, then advance. */
  private handleMusicError(id: string, songId: string, reason: string): void {
    if (id !== this.currentMusicId) return
    this.emit('notice', { message: `Couldn't play this track: ${reason}`, kind: 'error', code: 'playback-failed' })
    this.handleMusicEnd(id, songId) // clears state + emits 'ended' so the renderer advances
  }

  /** Natural end of a music track (ffmpeg drained). Ignored if superseded. */
  private handleMusicEnd(id: string, songId: string): void {
    if (id !== this.currentMusicId) return
    const advanced = this.nearEndFired
    this.currentMusicId = null
    this.currentSong = null
    this.nearEndFired = false
    this.musicBuffering = false
    this.emitPlayerStatus('idle')
    if (!advanced) this.emit('ended', songId)
  }

  /** 500ms heartbeat: report music + ambience position, trigger a crossfade near track end. */
  private tick(): void {
    this.tickMusic()
    this.emitAmbienceStatus()
  }

  private tickMusic(): void {
    if (!this.currentMusicId || !this.currentSong) return
    const input = this.mixer.getInput(this.currentMusicId)
    if (!input) return

    // First PCM has flowed → the cold-start buffering window is over.
    if (this.musicBuffering && input.positionSec > 0) this.musicBuffering = false

    const dur = this.currentSong.duration
    if (!this.nearEndFired && dur > 0) {
      const lead = Math.min(this.crossfadeMs / 1000, dur * 0.25)
      if (input.positionSec >= dur - lead) {
        this.nearEndFired = true
        this.emit('ended', this.currentSong.id) // ask the renderer to advance (→ crossfade)
      }
    }
    this.emitPlayerStatus()
  }

  /**
   * Emit each live ambience layer's progress for its card's bar. Loop layers report the
   * mixer input's loop position; random layers report a countdown to the next one-shot
   * (elapsed of the chosen interval). Only emits when at least one layer is live, so an
   * idle mixer stays quiet.
   */
  private emitAmbienceStatus(): void {
    const layers: AmbienceLayerStatus[] = []
    for (const slotId of this.loopSlots) {
      const input = this.mixer.getInput(`amb:${slotId}`)
      if (input) layers.push({ slotId, positionSec: input.positionSec, durationSec: input.song.duration })
    }
    const now = Date.now()
    for (const [slotId, layer] of this.randomLayers) {
      const total = layer.delayMs / 1000
      const remaining = Math.max(0, (layer.nextFireAt - now) / 1000)
      const elapsed = layer.paused ? 0 : Math.max(0, total - remaining)
      layers.push({ slotId, positionSec: elapsed, durationSec: total })
    }
    if (layers.length) this.emit('ambienceStatus', layers)
  }

  private emitPlayerStatus(state?: PlayerStatus['state']): void {
    const pos = this.currentMusicId
      ? (this.mixer?.getInput(this.currentMusicId)?.positionSec ?? 0)
      : 0
    const status: PlayerStatus = {
      state: state ?? this.mapState(),
      songId: this.currentSong?.id,
      positionSec: pos,
      durationSec: this.currentSong?.duration ?? 0,
      volume: this.volume
    }
    this.emit('playerStatus', status)
  }

  private mapState(): PlayerStatus['state'] {
    if (this.musicPaused) return 'paused'
    if (this.musicBuffering && this.currentMusicId) return 'buffering'
    return this.currentMusicId ? 'playing' : 'idle'
  }

  dispose(): void {
    if (this.statusTimer) clearInterval(this.statusTimer)
    for (const slotId of [...this.randomLayers.keys()]) this.clearRandomLayer(slotId)
    this.loopSlots.clear()
    this.player.stop(true)
    this.mixSource?.push(null)
    this.mixer.destroy()
    void this.disconnect()
  }
}
