# QuestStream

A bring-your-own-audio **mixer for tabletop game masters**. Build a soundtrack
from your own files or links, layer ambience and one-shot effects, snapshot whole
**scenes**, and play it to your table — on your own speakers or streamed into a
Discord voice channel. Winamp-style three-pane library, [Nord](https://www.nordtheme.com/)
theme, Electron + React + TypeScript.

> You don’t need Discord to start — the **local jukebox** plays on your machine
> right away. Add a bot token only when you want to stream into a voice channel.

## Features

- **Bring your own audio** — import **local files** (MP3/FLAC/WAV/OGG/…) or paste a
  link (YouTube, SoundCloud, Bandcamp, and other `yt-dlp`-supported sites). Tracks
  are auto-tagged with title/artist/album and filed into a three-pane browser.
- **Live mixer for GMs** — a music queue with crossfade, plus **ambience layers**
  that loop under it (rain, crowd, fire), each with its own volume.
- **Organic one-shots** — turn a layer into a **random** mode that fires sounds from
  a pool at random intervals (a distant wolf howl, a creaking timber).
- **Soundboard** — drag a track to make a one-shot effect, bind a **hotkey**, and
  optionally **duck** the music while it plays. A manual narration-duck button too.
- **Scenes** — snapshot the whole mix (queue + layers + volumes) and recall it in one
  click. Plus classic playlists.
- **Share packs** — export a scene or playlist as a portable `.questpack` (metadata
  only, no audio) and import others’.
- **DSP presets** — colour a track with Cavern / Telephone / Old Radio / Underwater.
- **Phone / Stream Deck remote** — enable the LAN remote in Settings and scan the QR with
  your phone to control playback, scenes and the soundboard from across the table. Pairing
  hands the phone a bearer token (the QR carries only a one-time code). For a Stream Deck or
  other non-browser HTTP client, reveal the raw token under Settings → Advanced and send it
  as `Authorization: Bearer <token>` to `POST /api/cmd`.
- **Local-first** — your library, scenes, imported audio and bot token live on your
  machine. No accounts, no cloud.

## External tools

The app shells out to standalone prebuilt binaries (no native npm modules):

- **Node.js** 22 LTS · **yt-dlp** (link resolution & metadata) · **ffmpeg/ffprobe**
  (audio decode/normalize).

On another machine put these on `PATH` (or set `QUESTSTREAM_YTDLP_PATH` /
`QUESTSTREAM_FFMPEG_PATH` / `QUESTSTREAM_FFPROBE_PATH`). When packaged as a Flatpak they’re
bundled (see [PACKAGING.md](PACKAGING.md)).

## Running

```bash
npm install        # one time
npm run dev        # development (hot reload)

npm run build      # production bundle into ./out
npm start          # preview the production build
```

> In a sandboxed container Electron needs `--no-sandbox`
> (`npm run build && npx electron . --no-sandbox`). On a normal desktop
> `npm run dev` works as-is.

## Setting up the Discord bot (optional)

1. [Discord Developer Portal](https://discord.com/developers/applications) →
   **New Application** → **Bot** → **Reset Token** and copy it. Only the `Guilds`
   and `GuildVoiceStates` intents are used (no privileged intents).
2. Invite the bot with the **Connect** and **Speak** voice permissions
   (OAuth2 → URL Generator → scope `bot`).
3. Launch the app → **⚙ Settings**, paste the token, **Save & Connect**.
4. Pick a server + voice channel in the top bar, **Join**, queue tracks, hit play.

## Responsibility

QuestStream is a **player, not a content library**. You are responsible for
complying with the terms of service of any source you use and with the copyright of
the material you play; it’s intended for content you own or are licensed to use.
Shared `.questpack` files contain metadata and links only, never audio. Not
affiliated with YouTube or Discord.

## Support

QuestStream is free and every feature is unlocked — there’s no paid tier.

## Architecture

```
src/
  shared/        types + IPC contract + effect/pack definitions
  main/          Electron main process (Node)
    index.ts         app bootstrap, window, lifecycle
    config.ts        local token/settings store (encrypted at rest)
    library/
      store.ts       JSON library (songs/playlists/scenes/soundboard; no native deps)
      media.ts       local-file import (copy into sandbox) + ffprobe metadata
      packs.ts       export/import shareable scene & playlist packs
    bot/
      DiscordBot.ts  voice connection + mixer orchestration (music/ambience/SFX/duck/random)
      Mixer.ts       pure-JS PCM mixer (local files + yt-dlp sources + DSP)
      effects.ts     DSP preset → ffmpeg filter chain
      random.ts      organic one-shot scheduling helpers
      ytdlp.ts       link resolution + metadata
      binaries.ts    locates yt-dlp / ffmpeg / ffprobe
    remote/
      server.ts      LAN HTTP remote (token-gated) — Stream Deck + phone
      page.ts        the phone-facing remote web page
    ipc/handlers.ts  wires store + bot + import + packs + remote to the renderer
  preload/       contextBridge → window.api
  renderer/      React UI (Nord theme, dnd-kit drag-and-drop)
```

### Why no SQLite / native modules

The build environment has no C compiler, so every native module is replaced by a
pure-JS equivalent: a JSON library store instead of `better-sqlite3`, `opusscript`
instead of `@discordjs/opus`, `libsodium-wrappers` for voice encryption. `yt-dlp`
and `ffmpeg` are standalone prebuilt binaries.

## Notes & caveats

- Link playback depends on `yt-dlp` staying current; run `yt-dlp -U` (or re-download
  the binary) if a source stops resolving. Local files keep working offline.
- The phone remote binds to your LAN and is gated by a private token in its pairing
  link — only share that link with people you trust on your network.
# QuestStream
