#!/usr/bin/env bash
# Wipe QuestStream's user data for a true blank-slate test (first-run disclaimer, onboarding,
# sample-pack install, etc). Run ON YOUR HOST — this deletes your library, config, AND any
# imported media for the app.
#
# Why it removes more than one directory: the app auto-recovers a fresh profile by copying
# from a legacy-named sibling (src/main/library/migrate.ts → seedFromLegacyProfile, for the
# kenku-clone → queststream → QuestStream renames). So deleting only ~/.config/QuestStream
# would silently re-seed on the next launch. To actually start empty we clear the active
# profile AND every sibling the seeder recognizes.
set -euo pipefail

cfg="${XDG_CONFIG_HOME:-$HOME/.config}"

# Active productName profile + the prior rename names the seeder will copy from.
profiles=("QuestStream" "queststream" "kenku-clone" "kenku clone")

removed=0
for p in "${profiles[@]}"; do
  d="$cfg/$p"
  if [ -e "$d" ]; then
    echo "removing $d"
    rm -rf "$d"
    removed=1
  fi
done

# A Flatpak install keeps its data under ~/.var/app, not ~/.config — clear it too if present.
flatpak_dir="$HOME/.var/app/io.github.WilderSelf.QuestStream"
if [ -e "$flatpak_dir" ]; then
  echo "removing $flatpak_dir (flatpak)"
  rm -rf "$flatpak_dir"
  removed=1
fi

if [ "$removed" -eq 0 ]; then
  echo "nothing to remove under $cfg — already a blank slate."
else
  echo "done — the next launch (dev or AppImage) starts fresh."
fi
