#!/usr/bin/env bash
# Fetch the external tools the Flatpak bundles, into ./bin (x86_64 Linux).
# Run once before `npm run pack:flatpak` (bin/ is gitignored — it's a build artifact).
#
# Reproducible releases: pin exact versions via env vars and record them in the
# GitHub Release notes, e.g.:
#   YTDLP_VERSION=2025.01.26 DENO_VERSION=v2.1.4 FFMPEG_VERSION=7.0.2 npm run pack:binaries
# Defaults pull the latest of each (fine for local/dev, NOT reproducible).
#
# Alternatively, if you already have known-good copies (e.g. in ~/.local/bin):
#   mkdir -p bin && cp ~/.local/bin/{yt-dlp,ffmpeg,ffprobe,deno} bin/ && chmod +x bin/*
set -euo pipefail
cd "$(dirname "$0")/.."

YTDLP_VERSION="${YTDLP_VERSION:-latest}"
DENO_VERSION="${DENO_VERSION:-latest}"
FFMPEG_VERSION="${FFMPEG_VERSION:-release}" # johnvansickle: "release" = latest, else e.g. 7.0.2

mkdir -p bin
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "→ yt-dlp ($YTDLP_VERSION)"
if [ "$YTDLP_VERSION" = "latest" ]; then
  ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
else
  ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"
fi
curl -fL -o bin/yt-dlp "$ytdlp_url"
chmod +x bin/yt-dlp

echo "→ ffmpeg + ffprobe (johnvansickle static, $FFMPEG_VERSION)"
curl -fL -o "$tmp/ff.tar.xz" \
  "https://johnvansickle.com/ffmpeg/releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz"
tar -xf "$tmp/ff.tar.xz" -C "$tmp"
ffdir="$(find "$tmp" -maxdepth 1 -type d -name 'ffmpeg-*-amd64-static' | head -1)"
cp "$ffdir/ffmpeg" "$ffdir/ffprobe" bin/
chmod +x bin/ffmpeg bin/ffprobe

echo "→ deno ($DENO_VERSION)"
if [ "$DENO_VERSION" = "latest" ]; then
  deno_url="https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
else
  deno_url="https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip"
fi
curl -fL -o "$tmp/deno.zip" "$deno_url"
unzip -oq "$tmp/deno.zip" -d bin
chmod +x bin/deno

echo
echo "Bundled into ./bin (yt-dlp=$YTDLP_VERSION ffmpeg=$FFMPEG_VERSION deno=$DENO_VERSION):"
ls -1sh bin
