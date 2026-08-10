// Enforces the CLAUDE.md rule that every `window.api.<ns>.<method>` the renderer uses
// is mirrored in src/renderer/preview-api.js — otherwise the browser preview harness
// crashes on the missing mock. Scans renderer sources for direct usages and executes
// the mock script in a vm sandbox to compare shapes. No electron, no network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const rendererRoot = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(entry)) yield p
  }
}

/** Every window.api.<ns>.<method> property path used by renderer sources. */
function usedApiMethods(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>()
  for (const file of walk(join(rendererRoot, 'src'))) {
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(/window\.api\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
      const [, ns, method] = m
      if (!used.has(ns)) used.set(ns, new Set())
      used.get(ns)!.add(method)
    }
  }
  return used
}

function mockApi(): Record<string, Record<string, unknown>> {
  const script = readFileSync(join(rendererRoot, 'preview-api.js'), 'utf8')
  const sandbox: { window: { api?: Record<string, Record<string, unknown>> } } = { window: {} }
  runInNewContext(script, sandbox)
  assert.ok(sandbox.window.api, 'preview-api.js did not assign window.api')
  return sandbox.window.api!
}

test('every window.api method the renderer uses exists on the preview mock', () => {
  const used = usedApiMethods()
  assert.ok(used.size > 0, 'expected renderer sources to use window.api')
  const api = mockApi()
  const missing: string[] = []
  for (const [ns, methods] of used) {
    for (const method of methods) {
      if (typeof api[ns]?.[method] !== 'function') missing.push(`${ns}.${method}`)
    }
  }
  assert.deepEqual(
    missing.sort(),
    [],
    `preview-api.js is missing mocks (add them or the preview harness crashes): ${missing.join(', ')}`
  )
})
