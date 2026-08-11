// Architectural guarantee as a cheap test: the preview path must be structurally
// unable to reach the Discord voice pipeline. If a refactor wires the preview bus
// into the live send path, these greps go red before any human hears the bug.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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

// The scene builder edits drafts and auditions through the preview bus ONLY.
// Reaching for the live player/ambience IPC from builder code is the exact bug
// class the redesign exists to prevent (Commander's Intent #1).
const BUILDER_COMPONENT = /^(SceneBuilder|Draft|LibraryPalette)/

test('scene-builder components never call the live player or ambience IPC', () => {
  const dir = join(ROOT, 'src/renderer/src/components')
  const files = readdirSync(dir).filter((f) => BUILDER_COMPONENT.test(f))
  assert.ok(files.length >= 4, `expected the builder component family, found: ${files}`)
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8')
    for (const banned of ['window.api.player', 'window.api.ambience']) {
      assert.ok(!src.includes(banned), `${f} must not use ${banned}`)
    }
  }
})
