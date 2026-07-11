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
Uses the shared **workflow kit** (user-scope `/ship` `/advance` `/wrap` `/reflect` `/curate` +
`planner`/`reviewer` agents). This repo's profile is `.claude/workflow.json` (kept local per the
`.claude/` gitignore): `validate` = `npm run typecheck` + `npm test` + `npm run build`,
`merge_model: pr-gated`, `plan_path` → `~/.claude/plans/queststream.md`.
- **`pr-gated`**: `/ship` (and `/advance`) run the validate gate + reviewer, then push a `feat/*`
  branch and open a PR that squash-auto-merges on green CI — the flow in **Version control** above.
  Releases still cut directly to `main` via `npm run release -- 0.X.Y`. Same guardrails: no
  force-push; validate must be green before commit.
- **Planning is memory-driven, not spec-driven.** The knowledge base + session bridge is the
  project memory (`MEMORY.md` + `memory/*.md`), not `specs/` or `HANDOFF.md`. `/advance` selects
  the next increment from the approved plan (`plan_path`) — which must enumerate the active
  milestone. When the roadmap is fully shipped and the phase is "hold major changes," there is no
  active milestone: `/advance` correctly stops rather than inventing feature work.
