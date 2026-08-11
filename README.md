# QuestStream

A bring-your-own-audio **mixer for tabletop game masters**. Build a soundtrack
from your own files or links, layer ambience and one-shot effects, snapshot whole
**scenes**, and play it to your table — on your own speakers or streamed into a
Discord voice channel. Winamp-style three-pane library, [Nord](https://www.nordtheme.com/)
theme, Electron + React + TypeScript.

> You don’t need Discord to start — the **local jukebox** plays on your machine
> right away. Add a bot token only when you want to stream into a voice channel.

<!-- Screenshot: drop an image at docs/screenshot.png and uncomment the next line -->
<!-- ![QuestStream](docs/screenshot.png) -->

## Install (Linux · AppImage)

Download the latest `.AppImage` from the
[**Releases**](https://github.com/WilderSelf/QuestStream/releases/latest) page, then:

```bash
chmod +x QuestStream-*.AppImage
./QuestStream-*.AppImage
# no FUSE? → ./QuestStream-*.AppImage --appimage-extract-and-run
```

It's a single self-contained file — `yt-dlp`, `ffmpeg`, `ffprobe`, and `deno` are bundled,
nothing to install separately. On first launch it offers to **add itself to your
applications menu** (one click), and it **auto-updates** from GitHub Releases.

> x86_64 Linux. Settings live in `~/.config/QuestStream/`. Prefer a sandbox? A Flatpak
> build is also available — see [PACKAGING.md](PACKAGING.md) (cookies-file mode only there).

## Features

- **Bring your own audio** — import **local files** (MP3/FLAC/WAV/OGG/…) or paste a
  link (YouTube, SoundCloud, Bandcamp, and other `yt-dlp`-supported sites) into the
  **import workbench**: drop files or paste a link and keep working while arrivals
  stream in (duplicates say so honestly). Then run untagged items through
  **tag triage** — audition each one over a GM-only preview and tag as you listen.
- **Live mixer for GMs** — a music queue with crossfade, plus **ambience layers**
  that loop under it (rain, crowd, fire), each with its own volume.
- **Organic one-shots** — turn a layer into a **random** mode that fires sounds from
  a pool at random intervals (a distant wolf howl, a creaking timber).
- **Soundboard** — drag a track to make a one-shot effect, bind a **hotkey**, and
  optionally **duck** the music while it plays. A manual narration-duck button too.
- **Scenes** — editable documents, not just snapshots: build them in the **scene
  builder** (track list with a start marker, per-scene crossfade and end-of-list
  behavior, ambience layers, per-scene sound pads, a GM note), open them on a
  **scene page** with zero audio side effects, and **preview them privately**
  while the table keeps hearing the live mix. Play with Music/Ambience include
  toggles, or one-press recall on **F1–F8**. Plus classic playlists.
- **Find anything** — **⌘/Ctrl+K** opens the seeker: tracks, scenes, and actions
  from one input, anywhere in the app.
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

## Keyboard shortcuts

| Keys | Where | What |
| --- | --- | --- |
| `F1`–`F8` | anywhere | Recall the first eight scenes (one press, crossfades) |
| hold `D` | anywhere | Duck the whole mix while you speak (release to restore) |
| `⌘K` / `Ctrl+K` | anywhere (even in a field) | Open the seeker |
| `Esc` | seeker open | Close the seeker |
| `Space` / `Enter` / `S` | tag triage | Listen toggle / save & next / skip |
| soundboard & scene-pad hotkeys | anywhere | User bindings — they always beat the built-ins above |

## External tools

The app shells out to standalone prebuilt binaries (no native npm modules):

- **Node.js** 22 LTS · **yt-dlp** (link resolution & metadata) · **ffmpeg/ffprobe**
  (audio decode/normalize).

In the packaged **AppImage** (and Flatpak) these are bundled — nothing to install. Running
from source, put them on `PATH` (or set `QUESTSTREAM_YTDLP_PATH` / `QUESTSTREAM_FFMPEG_PATH`
/ `QUESTSTREAM_FFPROBE_PATH`), or just drop them in the repo's `bin/` (see
[PACKAGING.md](PACKAGING.md)). yt-dlp can also be updated in-app from ⚙ Settings.

## Run from source (development)

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
