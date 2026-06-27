#!/usr/bin/env bash
# Diagnose a YouTube "HTTP 403 / no audio" by testing which yt-dlp variant can actually
# DOWNLOAD audio on THIS machine/network. Run it on the host (so browser cookies resolve):
#
#   ./scripts/diag-youtube.sh                       # tests the default troublesome video
#   ./scripts/diag-youtube.sh "https://youtu.be/…"  # test a specific URL
#
# Each variant downloads ~1.5 MB and reports PASS / FAIL. Whatever PASSes is the fix.
set -uo pipefail
cd "$(dirname "$0")/.."

URL="${1:-https://www.youtube.com/watch?v=9rW754sMJLk}"
YTDLP=./bin/yt-dlp
NEED=1000000 # treat ≥1 MB downloaded as success

test_variant() {
  local label="$1"; shift
  local errf; errf="$(mktemp)"
  local n
  n=$(timeout 45 "$YTDLP" -f bestaudio/best -o - --no-playlist --quiet --no-warnings "$@" "$URL" \
        2>"$errf" | head -c 1500000 | wc -c)
  if [ "${n:-0}" -ge "$NEED" ]; then
    printf "  %-26s PASS  (%s bytes)\n" "$label" "$n"
  else
    local why
    why=$(grep -iom1 'HTTP Error 403\|Forbidden\|could not find.*cookies\|could not copy.*cookie\|Sign in to confirm\|Video unavailable\|Private video\|PO.token\|requested format' "$errf" | head -1)
    printf "  %-26s FAIL  (%s bytes)  %s\n" "$label" "$n" "${why:-(see below)}"
    grep -i 'error' "$errf" | head -2 | sed 's/^/        /'
  fi
  rm -f "$errf"
}

echo "yt-dlp $($YTDLP --version) — $URL"
echo "(downloading ~1.5 MB per test; this takes a minute or two)"
echo
test_variant "default (no cookies)"
test_variant "firefox cookies"        --cookies-from-browser firefox
test_variant "android_vr client"      --extractor-args youtube:player_client=android_vr
test_variant "tv client"              --extractor-args youtube:player_client=tv
test_variant "web_safari client"      --extractor-args youtube:player_client=web_safari
test_variant "mweb client"            --extractor-args youtube:player_client=mweb
test_variant "firefox + android_vr"   --cookies-from-browser firefox --extractor-args youtube:player_client=android_vr
echo
echo "→ Tell me which line(s) say PASS and I'll wire that into the app."
