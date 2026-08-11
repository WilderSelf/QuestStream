// Architectural guarantee as a cheap test: the preview path must be structurally
// unable to reach the Discord voice pipeline. If a refactor wires the preview bus
// into the live send path, these greps go red before any human hears the bug.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

// Files that make up the preview bus. src/main/ipc/preview.ts joins in Phase 3.3 —
// listed now so its very first version is already under the ban.
const PREVIEW_SOURCES = ['src/main/bot/PreviewEngine.ts', 'src/main/ipc/preview.ts']

const FORBIDDEN = ['@discordjs/voice', 'DiscordBot', 'AudioPlayer']

test('preview sources never reference the Discord voice pipeline', () => {
  let checked = 0
  for (const rel of PREVIEW_SOURCES) {
    const path = join(ROOT, rel)
    if (!existsSync(path)) continue
    checked++
    const src = readFileSync(path, 'utf8')
    for (const term of FORBIDDEN) {
      assert.ok(!src.includes(term), `${rel} must not reference ${term}`)
    }
  }
  assert.ok(checked >= 1, 'no preview sources found — paths in PREVIEW_SOURCES are stale')
})
