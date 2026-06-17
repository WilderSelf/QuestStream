# Packaging QuestStream as a Flatpak

This produces a fully self-contained Flatpak: the app, Electron, and the external
tools (`yt-dlp`, `ffmpeg`, `ffprobe`, `deno`) are all bundled, and the app is granted
**no host-filesystem access**, so everything it writes lives under
`~/.var/app/io.github.WilderSelf.QuestStream/`. Removing the Flatpak with
`--delete-data` erases all of it.

> **Build host:** any **x86_64 Linux** machine with `flatpak`, `flatpak-builder`, and
> Node 22. The dev sandbox this repo was written in does **not** have `flatpak-builder`,
> so the Flatpak can't be built there — do this on your host.

---

## One-time host setup

```bash
# Flatpak + the builder + Node/npm (the build tools run on the host, not the dev container)
sudo dnf install flatpak flatpak-builder nodejs npm   # Fedora; use your distro's package

# Flathub remote (REQUIRED before the install below, or you get
# "No remote refs found for 'flathub'")
flatpak remote-add --if-not-exists --user flathub https://flathub.org/repo/flathub.flatpakrepo

# The runtime, SDK, and Electron base app the manifest targets
flatpak install --user flathub \
  org.freedesktop.Platform//24.08 \
  org.freedesktop.Sdk//24.08 \
  org.electronjs.Electron2.BaseApp//24.08
```

## Build

```bash
cd QuestStream
npm install                # pulls electron-builder (devDependency)
npm run pack:binaries      # downloads yt-dlp/ffmpeg/ffprobe/deno into ./bin (gitignored)
npm run pack:icon          # (optional) regenerate build/icon.png — already committed
npm run pack:flatpak       # electron-vite build + electron-builder flatpak target
```

> `bin/` is **gitignored** (the binaries are large — `deno` alone exceeds GitHub's 100 MB
> file limit), so `pack:binaries` is required on a fresh clone before `pack:flatpak`.

Output: **`dist-flatpak/QuestStream-0.1.0.flatpak`** (a single-file bundle).

## Cutting a release (self-hosted, GitHub Releases)

1. Bump `version` in `package.json` (the in-app version comes from it via `app.getVersion()`).
2. **Pin** the bundled-tool versions for a reproducible build and record them in the notes:
   ```bash
   YTDLP_VERSION=2025.xx.xx DENO_VERSION=v2.x.x FFMPEG_VERSION=7.0.2 npm run pack:binaries
   ```
3. `npm run typecheck && npm test` (must be green), then `npm run pack:flatpak`.
4. **Install the built `.flatpak` on a clean machine** and run the smoke test (first-run
   disclaimer → local-file + URL import → scene → soundboard/duck → random layer → DSP →
   pack export/import → phone remote pairing → Discord voice). Rename a bundled binary and
   relaunch to confirm the "tools not found" toast appears and the app stays up.
5. `git tag vX.Y.Z` and create a GitHub Release; attach `dist-flatpak/QuestStream-X.Y.Z.flatpak`
   with install instructions (the **Install & run** section below) and the pinned tool versions.

## Install & run

```bash
flatpak install --user ./dist-flatpak/QuestStream-*.flatpak
flatpak run io.github.WilderSelf.QuestStream
```

## Uninstall — removes the app AND all its data

```bash
flatpak uninstall --delete-data io.github.WilderSelf.QuestStream
```

`--delete-data` deletes `~/.var/app/io.github.WilderSelf.QuestStream/` (config +
cache). Because the app has no `--filesystem` permission, it never wrote anything
outside that directory, so nothing is left behind.

---

## What's contained where

Inside the sandbox, Electron's `userData` follows the Flatpak XDG dirs:

| Data | Sandbox path | On the host |
| --- | --- | --- |
| Settings (`config.json` — encrypted token) | `$XDG_CONFIG_HOME/queststream` | `~/.var/app/<id>/config/queststream/` |
| Library (`library.json`) | same as above | `~/.var/app/<id>/config/queststream/` |
| yt-dlp cache, Chromium cache | `$XDG_CACHE_HOME` | `~/.var/app/<id>/cache/` |

(`<id>` = `io.github.WilderSelf.QuestStream`.)

## Permissions (and why)

Declared in `electron-builder.yml` → `flatpak.finishArgs`:

- `--share=network` — yt-dlp resolves YouTube; Discord gateway; MusicBrainz enrichment.
- `--socket=pulseaudio` — audio output (works with PipeWire's PulseAudio shim).
- `--socket=x11` + `--socket=wayland` + `--share=ipc` + `--device=dri` — display + GPU for
  Electron. (X11 is shared outright, not `fallback-x11`: Electron defaults to X11 and
  XWayland covers Wayland sessions — see HANDOFF gotcha #13.)
- **No `--filesystem=*`** — the app can't read or write your home or any host path. (The
  "local audio files" feature is deferred, so it needs no file access.)

## Notes & decisions

- **Sandbox done right.** The Flatpak runs Electron under the Electron base app's
  `zypak`, so Chromium's sandbox works *without* `--no-sandbox`. The dev-only
  `--no-sandbox` flag is not used here. (`webPreferences.sandbox` stays `false` because
  the preload is ESM — unrelated to the OS sandbox; see HANDOFF §2.)
- **No compiler needed.** `npmRebuild`/`nodeGypRebuild` are off; `@snazzah/davey` ships a
  prebuilt N-API binary, and ffmpeg/yt-dlp/deno are bundled binaries — nothing compiles.
- **x86_64 only.** `scripts/fetch-binaries.sh` downloads x86_64 static builds. For arm64
  you'd swap the download URLs and build on an arm64 host.
- **App ID** is `io.github.WilderSelf.QuestStream`. To change it, edit `appId` in
  `electron-builder.yml` (and re-run the build).

## Troubleshooting

- *`flatpak-builder: command not found`* — install it (see host setup).
- *Build fails fetching the runtime/base app* — run the `flatpak install` step above so
  they're present locally before `pack:flatpak`.
- *No audio* — confirm PipeWire/PulseAudio on the host; the `--socket=pulseaudio` grant is
  already in the manifest.
- *A video won't play but others do* — usually a removed/blocked video (you'll get the
  in-app error toast). To rule out bundling, run `flatpak run --command=sh <id>` then
  `yt-dlp --version` and `ffmpeg -version` to confirm the tools are present at `/app/...`.
