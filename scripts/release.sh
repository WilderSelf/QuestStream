#!/usr/bin/env bash
# Cut a real GitHub Release of QuestStream so the in-app auto-updater can be exercised
# end-to-end. Builds the AppImage AND the latest-linux.yml update manifest, then lets
# electron-builder upload BOTH to a GitHub Release. electron-updater needs the .yml
# sitting next to the .AppImage on the release to detect a newer version — uploading
# only the AppImage silently breaks auto-update, which is the whole thing we're testing.
#
# Testing auto-update needs TWO releases at increasing versions:
#   ./scripts/release.sh 0.1.0     # cut the OLDER release; install that build and run it
#   ./scripts/release.sh 0.1.1     # cut the NEWER release; the running 0.1.0 should
#                                  #   detect, download, and offer to install 0.1.1
#
# Usage:
#   ./scripts/release.sh 0.1.1             # explicit MAJOR.MINOR.PATCH
#   ./scripts/release.sh patch             # bump patch from package.json (0.1.0 -> 0.1.1)
#   ./scripts/release.sh minor | major
#   ./scripts/release.sh 0.1.1 --draft     # upload as a DRAFT (won't auto-update until
#                                          #   you publish it in the GitHub UI)
#   ./scripts/release.sh 0.1.1 --no-push   # don't push the version commit + tag
#                                          #   (electron-builder still creates the remote
#                                          #    tag at the default branch head — only use
#                                          #    this if main is already pushed)
#   ./scripts/release.sh 0.1.1 --dry-run   # build + show what WOULD publish, upload nothing
#
# Run this ON YOUR HOST (not the dev container — same GUI-reaping reason as
# build-and-install.sh, and the container has no GitHub credentials).
#
# Requires a GitHub token with `repo` scope in the environment:
#   export GH_TOKEN="$(gh auth token)"      # if you use the gh CLI
#   # ...or a classic/fine-grained PAT:  export GH_TOKEN=ghp_xxx
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

VERARG=""; DRAFT=0; PUSH=1; DRYRUN=0
for a in "$@"; do
  case "$a" in
    --draft)    DRAFT=1 ;;
    --no-push)  PUSH=0 ;;
    --dry-run)  DRYRUN=1 ;;
    -*)         echo "unknown flag: $a" >&2; exit 1 ;;
    *)          if [ -n "$VERARG" ]; then echo "unexpected extra arg: $a" >&2; exit 1; fi
                VERARG="$a" ;;
  esac
done

[ -n "$VERARG" ] || { echo "error: pass a version (e.g. 0.1.1) or a bump (patch|minor|major)" >&2; exit 1; }

# electron-builder's GitHub publisher reads GH_TOKEN / GITHUB_TOKEN. Fail early with a
# clear message rather than building for two minutes and dying at the upload step.
if [ "$DRYRUN" -eq 0 ] && [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "error: no GH_TOKEN/GITHUB_TOKEN set — needed to upload the release." >&2
  echo "       export GH_TOKEN=\"\$(gh auth token)\"   # or a PAT with repo scope" >&2
  exit 1
fi

# Resolve the target version: explicit semver, or a bump off the current package.json.
case "$VERARG" in
  major|minor|patch)
    VER="$(node -e "const[a,b,c]=require('./package.json').version.split('.').map(Number);const t=process.argv[1];console.log(t==='major'?[a+1,0,0].join('.'):t==='minor'?[a,b+1,0].join('.'):[a,b,c+1].join('.'))" "$VERARG")"
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    VER="$VERARG"
    ;;
  *)
    echo "error: version must be MAJOR.MINOR.PATCH (e.g. 0.1.1) or one of patch|minor|major" >&2
    exit 1
    ;;
esac

CUR="$(node -p "require('./package.json').version")"
echo "==> Releasing QuestStream v$VER  (was v$CUR)"

# Releases must come off a clean, coherent main. We DON'T lean on `npm version` for the
# clean-tree guard anymore (it bumps + tags + commits in one go, which mutated the repo even
# on a --dry-run); instead we set the version with --no-git-tag-version and create the commit
# + tag ourselves, only after the build succeeds.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  echo "warning: you are on '$BRANCH', not 'main'. The release tag will point here." >&2
  read -rp "Continue anyway? [y/N] " ans; [ "$ans" = "y" ] || [ "$ans" = "Y" ] || exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "error: working tree is dirty — commit or stash first so the release commit is clean." >&2
  git status --short >&2
  exit 1
fi

# A tag is a release's identity; if vX.Y.Z already exists you've almost certainly released it
# (or a prior run half-finished). Refuse rather than silently re-tagging the wrong commit.
if git rev-parse -q --verify "refs/tags/v$VER" >/dev/null; then
  echo "error: tag v$VER already exists locally. Pick a new version, or if a prior run failed" >&2
  echo "       mid-way, clean up with:  git tag -d v$VER  &&  git push origin :refs/tags/v$VER" >&2
  exit 1
fi

# Host SSH key for the push (mirrors build-and-install.sh — the in-container default key is
# rejected by GitHub; on a real host this is a harmless no-op if the key isn't there).
if [ -z "${GIT_SSH_COMMAND:-}" ] && [ -f "$HOME/.ssh/id_ed25519" ]; then
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519 -o IdentitiesOnly=yes"
fi

# Set package.json to the target version WITHOUT committing or tagging. Nothing is recorded in
# git yet — a --dry-run reverts this, and a real run commits/tags only after the build passes.
if [ "$CUR" != "$VER" ]; then
  echo "==> Setting package.json to $VER (git commit + tag happen after the build succeeds)"
  npm version "$VER" --no-git-tag-version >/dev/null
fi

echo "==> Installing deps"
npm install

# The AppImage bundles yt-dlp/ffmpeg/ffprobe/deno from bin/; fetch them if missing so we
# never ship a release that can't actually fetch or decode audio.
if [ ! -x "$ROOT/bin/yt-dlp" ]; then
  echo "==> Fetching bundled binaries (yt-dlp/ffmpeg/ffprobe/deno)"
  npm run pack:binaries
fi

echo "==> Gate: typecheck + tests"
npm run typecheck
npm test

# Draft releases are invisible to the public download URL electron-updater reads, so a
# DRAFT will NOT trigger auto-update until you publish it. Default to a real (published)
# release so the end-to-end test works without an extra manual click.
if [ "$DRAFT" -eq 1 ]; then RELEASE_TYPE="draft"; else RELEASE_TYPE="release"; fi

if [ "$DRYRUN" -eq 1 ]; then
  echo "==> DRY RUN: building AppImage + latest-linux.yml, NOT uploading"
  npm run build
  npx --no-install electron-builder --linux AppImage --publish never
  echo
  echo "    Artifacts in dist/ (these two would be uploaded to the release):"
  ls -1 "$ROOT"/dist/QuestStream-*-x86_64.AppImage "$ROOT"/dist/latest-linux.yml 2>/dev/null | sed 's/^/      /'
  # Read-only: undo the version bump so the repo is exactly as we found it. `npm version`
  # touches BOTH package.json and package-lock.json, so revert both.
  git checkout -- package.json package-lock.json 2>/dev/null || true
  echo "    Reverted version bump. Nothing committed, tagged, or uploaded."
  exit 0
fi

# Commit + tag + push BEFORE publishing. electron-builder's GitHub publisher attaches the
# release to tag vX.Y.Z; if that tag isn't already on the remote at the right commit, GitHub
# would create it pointing at whatever the default branch's HEAD is — a mismatch. Pushing the
# tag first guarantees the release points at this exact version-bump commit. The gate
# (typecheck + tests) and a clean tree already ran above, so reaching here means we're good.
echo "==> Recording release commit + tag v$VER"
# `npm version` bumped both package.json and package-lock.json — commit both so the tree is
# clean after the release (committing only package.json would leave the lockfile dangling).
if ! git diff --quiet -- package.json package-lock.json; then
  git commit -m "release: v$VER" -- package.json package-lock.json >/dev/null
fi
git tag -a "v$VER" -m "release: v$VER"

if [ "$PUSH" -eq 1 ]; then
  echo "==> Pushing commit + tag"
  git push --follow-tags origin "$BRANCH"
else
  echo "warning: --no-push set. The GitHub release will only point at this commit if the tag" >&2
  echo "         is on the remote. Push it before/right after this run:" >&2
  echo "           git push --follow-tags origin $BRANCH" >&2
fi

echo "==> Building + publishing GitHub release (type: $RELEASE_TYPE)"
# --publish always: upload the AppImage + latest-linux.yml to the release for tag v$VER.
# -c.publish.releaseType: override electron-builder's default ("draft") per the --draft flag.
npm run build
npx --no-install electron-builder --linux AppImage --publish always \
  -c.publish.releaseType="$RELEASE_TYPE"

echo
echo "==> Done. Release v$VER is up with QuestStream-$VER-x86_64.AppImage + latest-linux.yml."
if [ "$DRAFT" -eq 1 ]; then
  echo "    It is a DRAFT — publish it in the GitHub Releases UI before testing auto-update."
fi
echo
echo "    To test auto-update end-to-end:"
echo "      1. Install + run the OLDER release (e.g. v$CUR) if you haven't already."
echo "      2. With that build running, this newer v$VER should be detected within a"
echo "         minute (autoDownload is on) and offer to install — see src/main/appUpdater.ts."
