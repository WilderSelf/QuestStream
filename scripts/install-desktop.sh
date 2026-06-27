#!/usr/bin/env bash
# Add QuestStream (an AppImage) to your applications menu.
#
# Usage:
#   ./install-desktop.sh /path/to/QuestStream-*.AppImage
#   # or, run it from inside the AppImage (APPIMAGE is set automatically), then no arg needed.
#
# This is the same thing the in-app "Add to menu" button does, for people who prefer the
# terminal or want to script it. Writes a Desktop Entry + icon under ~/.local/share.
set -euo pipefail

APP_ID="io.github.WilderSelf.QuestStream"
APP_NAME="QuestStream"

appimage="${1:-${APPIMAGE:-}}"
if [ -z "$appimage" ]; then
  echo "error: pass the path to the .AppImage (or run from inside it)." >&2
  echo "usage: $0 /path/to/${APP_NAME}-*.AppImage" >&2
  exit 1
fi
appimage="$(readlink -f "$appimage")"
if [ ! -x "$appimage" ]; then
  echo "error: '$appimage' is not an executable AppImage." >&2
  exit 1
fi

apps_dir="$HOME/.local/share/applications"
icons_dir="$HOME/.local/share/icons"
mkdir -p "$apps_dir" "$icons_dir"

# Try to extract the bundled icon from the AppImage so the launcher shows it; if anything
# about extraction fails, fall back to the generic icon name — it must never abort the install.
icon_ref="$APP_NAME"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if (cd "$tmp" && "$appimage" --appimage-extract '*.png' >/dev/null 2>&1); then
  # The '*.png' glob only extracts the top-level icon, which is a *symlink* into
  # usr/share/icons/...; its target isn't extracted, so follow the link and extract that path
  # too. Then pick the largest real PNG (-type f skips the dangling symlink itself).
  link="$(find "$tmp/squashfs-root" -maxdepth 1 -name '*.png' 2>/dev/null | head -n1)"
  if [ -n "$link" ] && [ -L "$link" ]; then
    target="$(readlink "$link")"
    (cd "$tmp" && "$appimage" --appimage-extract "$target" >/dev/null 2>&1) || true
  fi
  found="$(find "$tmp/squashfs-root" -type f -name '*.png' -printf '%s\t%p\n' 2>/dev/null \
    | sort -rn | head -n1 | cut -f2-)"
  if [ -n "$found" ] && cp "$found" "$icons_dir/${APP_ID}.png" 2>/dev/null; then
    icon_ref="$icons_dir/${APP_ID}.png"
  fi
fi

desktop="$apps_dir/${APP_ID}.desktop"
cat > "$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Bring-your-own-audio mixer for tabletop GMs
Exec="${appimage}" %U
Icon=${icon_ref}
Terminal=false
Categories=AudioVideo;Audio;
StartupWMClass=${APP_NAME}
EOF
chmod 755 "$desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$apps_dir" >/dev/null 2>&1 || true

echo "✓ Installed: $desktop"
echo "  ${APP_NAME} should now appear in your applications menu."
