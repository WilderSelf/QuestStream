# QuestStream — project guidance

## Version control (pr-gated for feature work; releases still direct to `main`)
**Feature work is pr-gated** (converted from solo-main 2026-07-07 to match quill). `main` is
branch-protected: the required check `typecheck + test + build` (`.github/workflows/ci.yml`,
hosted `ubuntu-latest`) must pass, `strict` on, `enforce_admins: false`, no required reviews,
force-push/deletion blocked, `allow_auto_merge` + squash + delete-branch enabled. So changes go
via `feat/<slug>` → PR → CI green → `gh pr merge --auto --squash --delete-branch`; never force-merge.

**Releases still cut directly to `main`** — `enforce_admins: false` preserves the admin-bypass
push, so `scripts/release.sh` is unchanged. Cut releases from the container: `npm run release --
0.X.Y`, first enabling the HTTPS-over-gh push rewrite
(`git config --local url."https://github.com/".insteadOf "git@github.com:"`) so the script's own
`git push --follow-tags` lands the tag on the right commit. **Never `--no-push`** in-container —
it tags the wrong commit (learned at v0.2.3, fixed from v0.2.4).

## Showing UI changes
The Electron GUI can't launch in-container, but the renderer runs in a browser for the **Preview
MCP**: `preview_start` (config `preview`) → `preview_screenshot` renders the real UI with seeded
mock data (`src/renderer/preview-api.js`, served at `/` via `preview.html`). Use that for visual
verification — not hand-drawn mockups. **When you add a `window.api` method to the preload
(`src/preload/index.ts`), add it to `preview-api.js` too**, or the preview crashes on the missing mock.

## Automation & learning (Claude Code)
The user-scope `/advance` skill lands one unit of the approved plan per run.
`~/.claude/harness/run.sh` runs it in a loop. The profile is `.claude/workflow.json`, which is
local and gitignored: `validate` = `npm run typecheck` + `npm test` + `npm run build`,
`merge_model: pr-gated`, `plan_path: docs/plan.md`.
- **`pr-gated`**: each unit lands on a `feat/*` branch by a PR that squash-auto-merges on green
  CI, as in **Version control** above. Releases still go directly to `main` via
  `npm run release -- 0.X.Y`. No force-push. Validate must be green before a commit.
- `docs/plan.md` holds the active milestone and its status table. With no active milestone,
  `/advance` stops. It never invents feature work.
