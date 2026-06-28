// Mock of the Electron preload bridge (window.api) for browser-only visual review.
// Seeds a realistic library so the faceted browser, soundboard, scenes and playlists populate.
// Every IPC method resolves to a sane default; every subscription is a no-op unsubscribe.
;(function () {
  const now = 1_700_000_000_000
  const song = (id, artistId, albumId, title, kind, tags, duration) => ({
    id,
    artistId,
    albumId,
    title,
    url: 'https://example.com/' + id,
    videoId: id,
    duration,
    tags,
    addedAt: now,
    sourceType: 'youtube',
    kind
  })

  const artists = [
    { id: 'ar1', name: 'Adventurer’s Guild' },
    { id: 'ar2', name: 'Ambient Forge' },
    { id: 'ar3', name: 'Foley Works' }
  ]
  const albums = [
    { id: 'al1', artistId: 'ar1', title: 'Campaign Themes Vol. I' },
    { id: 'al2', artistId: 'ar1', title: 'Battle & Boss' },
    { id: 'al3', artistId: 'ar2', title: 'Places & Weather' },
    { id: 'al4', artistId: 'ar3', title: 'One-Shots' }
  ]
  const songs = [
    song('s1', 'ar1', 'al1', 'The Sleeping Dragon Inn', 'track', ['genre:fantasy', 'activity:social', 'mood:peace'], 213),
    song('s2', 'ar1', 'al1', 'Crossroads at Dusk', 'track', ['genre:fantasy', 'activity:travel', 'mood:mysterious'], 188),
    song('s3', 'ar1', 'al2', 'The Lich Awakens', 'track', ['genre:fantasy', 'activity:boss', 'mood:epic'], 247),
    song('s4', 'ar1', 'al2', 'Steel & Thunder', 'track', ['genre:fantasy', 'activity:combat', 'mood:tense'], 201),
    song('s5', 'ar1', 'al1', 'Neon Rain Bazaar', 'track', ['genre:cyberpunk', 'activity:shopping', 'mood:whimsical'], 175),
    song('s6', 'ar1', 'al2', 'Last Stand', 'track', ['genre:fantasy', 'activity:combat', 'mood:triumphant'], 220),
    song('a1', 'ar2', 'al3', 'Tavern Crowd', 'ambience', ['location:tavern', 'weather:crowd'], 600),
    song('a2', 'ar2', 'al3', 'Forest Night', 'ambience', ['location:woods', 'weather:night'], 600),
    song('a3', 'ar2', 'al3', 'Heavy Rain', 'ambience', ['location:town', 'weather:rain'], 600),
    song('a4', 'ar2', 'al3', 'Dripping Cavern', 'ambience', ['location:cave', 'weather:water'], 600),
    song('x1', 'ar3', 'al4', 'Sword Clash', 'sfx', ['category:combat'], 3),
    song('x2', 'ar3', 'al4', 'Fireball', 'sfx', ['category:magic'], 4),
    song('x3', 'ar3', 'al4', 'Wooden Door', 'sfx', ['category:door'], 2),
    song('x4', 'ar3', 'al4', 'Dramatic Sting', 'sfx', ['category:sting'], 5)
  ]
  const playlists = [
    { id: 'p1', name: 'Tavern Night', songIds: ['s1', 's5'], createdAt: now, updatedAt: now },
    { id: 'p2', name: 'Final Boss', songIds: ['s3', 's6', 's4'], createdAt: now, updatedAt: now }
  ]
  const scenes = [
    {
      id: 'sc1',
      name: 'Ambush on the Road',
      songIds: ['s4', 's6'],
      musicVolume: 0.8,
      currentIndex: 0,
      ambience: [{ songId: 'a2', volume: 0.5, playing: true }],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'sc2',
      name: 'Quiet Tavern',
      songIds: ['s1'],
      musicVolume: 0.6,
      currentIndex: 0,
      ambience: [{ songId: 'a1', volume: 0.7, playing: true }],
      createdAt: now,
      updatedAt: now
    }
  ]
  const soundboard = [
    { id: 'sb1', songId: 'x1', hotkey: '1', duckUnderMusic: false },
    { id: 'sb2', songId: 'x2', hotkey: '2', duckUnderMusic: true },
    { id: 'sb3', songId: 'x3', hotkey: 'd', duckUnderMusic: false }
  ]

  const library = { artists, albums, songs, playlists, scenes, soundboard }

  const ok = () => Promise.resolve({ ok: true })
  const noop = () => () => {}

  window.api = {
    library: {
      get: () => Promise.resolve(library),
      addUrl: ok,
      addFiles: () => Promise.resolve({ ok: true, added: 0 }),
      setEffect: ok,
      retag: ok,
      deleteSong: ok,
      onChanged: noop,
      onImportProgress: noop
    },
    soundboard: { add: ok, update: ok, remove: ok, trigger: ok },
    playlists: { save: ok, remove: ok, export: ok },
    scenes: { save: ok, remove: ok, export: ok },
    packs: { import: () => Promise.resolve({ ok: true }) },
    tools: {
      getStatus: () =>
        Promise.resolve([
          { name: 'yt-dlp', path: '/usr/bin/yt-dlp', found: true, source: 'system' },
          { name: 'ffmpeg', path: '/usr/bin/ffmpeg', found: true, source: 'system' },
          { name: 'ffprobe', path: '/usr/bin/ffprobe', found: true, source: 'system' }
        ]),
      updateYtdlp: () => Promise.resolve({ ok: true, version: '2026.06.20' })
    },
    cookies: {
      get: () => Promise.resolve({ mode: 'none', hasFile: false, browser: 'firefox' }),
      setMode: () => Promise.resolve({ ok: true, status: { mode: 'none', hasFile: false, browser: 'firefox' } }),
      importFile: ok
    },
    desktop: {
      getStatus: () => Promise.resolve({ isAppImage: false, installed: false }),
      install: ok
    },
    update: { onStatus: noop, install: ok, check: ok },
    discord: {
      hasToken: () => Promise.resolve(false),
      setToken: ok,
      connect: ok,
      disconnect: ok,
      getGuilds: () => Promise.resolve([]),
      getVoiceChannels: () => Promise.resolve([]),
      join: ok,
      leave: ok,
      onStatus: noop
    },
    player: {
      play: ok,
      prefetch: ok,
      pause: ok,
      resume: ok,
      stop: ok,
      seek: ok,
      setVolume: ok,
      setMusicVolume: ok,
      duck: ok,
      onStatus: noop,
      onEnded: noop
    },
    ambience: { play: ok, playRandom: ok, stop: ok, setVolume: ok, setPaused: ok, onStatus: noop },
    monitor: { enable: ok, onPcm: noop },
    remote: {
      onCommand: noop,
      pushState: () => {},
      getInfo: () => Promise.resolve({ enabled: false, port: 8723, url: '', error: undefined }),
      setEnabled: () => Promise.resolve({ enabled: false, port: 8723, url: '', error: undefined }),
      getToken: () => Promise.resolve('preview-token'),
      resetToken: () => Promise.resolve({ enabled: false, port: 8723, url: '', error: undefined })
    },
    app: { onNotice: noop }
  }
})()
