#!/usr/bin/env bash
# Build the latest QuestStream AppImage from main and install it to this system.
#
#   ./scripts/build-and-install.sh            # pull main, build, install to menu, launch
#   ./scripts/build-and-install.sh --no-pull  # build current working tree as-is
#   ./scripts/build-and-install.sh --no-run   # build + install, don't launch
#   ./scripts/build-and-install.sh --refresh-binaries  # re-fetch yt-dlp/ffmpeg/deno
#
# Run this ON YOUR HOST (not the dev container — the GUI gets reaped there).
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

PULL=1; RUN=1; REFRESH=0
for a in "$@"; do
  case "$a" in
    --no-pull) PULL=0 ;;
    --no-run) RUN=0 ;;
    --refresh-binaries) REFRESH=1 ;;
    *) echo "unknown flag: $a" >&2; exit 1 ;;
  esac
done

# Host SSH key (the in-container default key is rejected by GitHub). Override by exporting
# GIT_SSH_COMMAND yourself, or it falls back to your normal ssh if the key isn't there.
if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -f "$HOME/.ssh/id_ed25519" ]; then
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519 -o IdentitiesOnly=yes"
fi

if [ "$PULL" -eq 1 ]; then
  echo "==> Updating main"
  git checkout main
  git pull --ff-only
fi

echo "==> Installing deps"
npm install

if [ "$REFRESH" -eq 1 ] || [ ! -x "$ROOT/bin/yt-dlp" ]; then
  echo "==> Fetching bundled binaries (yt-dlp/ffmpeg/ffprobe/deno)"
  npm run pack:binaries
fi

echo "==> Gate: typecheck + tests"
npm run typecheck
npm test

echo "==> Building AppImage"
npm run pack:appimage

appimage="$(ls -t "$ROOT"/dist/QuestStream-*-x86_64.AppImage | head -n1)"
[ -n "$appimage" ] || { echo "error: no AppImage produced in dist/" >&2; exit 1; }
chmod +x "$appimage"
echo "==> Built: $appimage"

# Copy to a stable location so the menu entry survives the next rebuild overwriting dist/.
dest_dir="$HOME/Applications"
mkdir -p "$dest_dir"
dest="$dest_dir/QuestStream-x86_64.AppImage"
cp -f "$appimage" "$dest"
chmod +x "$dest"
echo "==> Installed to: $dest"

echo "==> Adding applications-menu entry"
"$ROOT/scripts/install-desktop.sh" "$dest"

if [ "$RUN" -eq 1 ]; then
  echo "==> Launching"
  if "$dest" --appimage-version >/dev/null 2>&1; then
    "$dest"
  else
    # No FUSE — extract-and-run fallback.
    "$dest" --appimage-extract-and-run
  fi
fi
