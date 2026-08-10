// Guards the theme-token contract in src/renderer/src/styles.css: every semantic
// colour token a theme is expected to restate (the "full semantic set" the styles.css
// header comment describes) must be declared in the bare :root block AND in every
// built-in :root[data-theme='…'] block. Aliases (--panel, --active*, --selected, …)
// and layout/type/space tokens deliberately live only in :root and are not listed here.
// When the contract grows (new semantic tokens), extend CONTRACT_TOKENS — the test then
// forces every theme block to pick the new tokens up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src/styles.css')
const css = readFileSync(cssPath, 'utf8')

const CONTRACT_TOKENS = [
  // surfaces
  'bg', 'surface', 'surface-raised', 'surface-over', 'field-bg', 'track',
  // borders + shadows
  'border', 'border-strong', 'border-subtle', 'shadow-1', 'shadow-2', 'shadow-3',
  // text
  'text', 'text-dim', 'text-faint',
  // primary set
  'primary', 'primary-hi', 'primary-press', 'primary-tint', 'on-primary',
  // semantic accents
  'live', 'live-tint', 'accent-deep', 'tag', 'danger', 'danger-tint', 'warn', 'ok',
  'scrim', 'on-tag', 'on-accent', 'on-solid', 'hover',
  // tag swatch palette
  'tag-red', 'tag-orange', 'tag-yellow', 'tag-green', 'tag-teal', 'tag-cyan',
  'tag-blue', 'tag-deepblue', 'tag-purple', 'tag-neutral'
]

/** Extract the body of the block that starts at the given selector occurrence. */
function blockBody(source: string, selectorStart: number): string {
  const open = source.indexOf('{', selectorStart)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced block')
}

function declaredTokens(body: string): Set<string> {
  const out = new Set<string>()
  for (const m of body.matchAll(/--([\w-]+)\s*:/g)) out.add(m[1])
  return out
}

/** The bare :root block (not a [data-theme] override). */
function rootBody(): string {
  for (const m of css.matchAll(/(^|\n)\s*:root\s*\{/g)) {
    return blockBody(css, m.index! + m[0].indexOf(':root'))
  }
  throw new Error('no :root block found')
}

function themeBlocks(): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = []
  for (const m of css.matchAll(/:root\[data-theme='([\w-]+)'\]\s*\{/g)) {
    blocks.push({ name: m[1], body: blockBody(css, m.index!) })
  }
  return blocks
}

test('bare :root declares every contract token', () => {
  const tokens = declaredTokens(rootBody())
  const missing = CONTRACT_TOKENS.filter((t) => !tokens.has(t))
  assert.deepEqual(missing, [], `:root is missing contract tokens: ${missing.join(', ')}`)
})

test('every built-in theme block restates the full contract', () => {
  const themes = themeBlocks()
  // Sanity: the built-ins (torchlit, daylight) must be found — an empty match list
  // would make the loop below pass vacuously.
  assert.ok(themes.length >= 2, `expected >=2 theme blocks, found ${themes.length}`)
  for (const { name, body } of themes) {
    const tokens = declaredTokens(body)
    const missing = CONTRACT_TOKENS.filter((t) => !tokens.has(t))
    assert.deepEqual(missing, [], `theme '${name}' is missing: ${missing.join(', ')}`)
  }
})

test('theme blocks do not restate alias tokens (aliases follow :root automatically)', () => {
  // --panel/--active*/--muted/--accent/--selected are var() aliases; a theme that
  // hardcodes them would silently detach from its own base tokens.
  const aliases = ['panel', 'panel-alt', 'active', 'active-hi', 'active-tint', 'accent', 'muted', 'selected']
  for (const { name, body } of themeBlocks()) {
    const tokens = declaredTokens(body)
    const restated = aliases.filter((a) => tokens.has(a))
    assert.deepEqual(restated, [], `theme '${name}' restates alias tokens: ${restated.join(', ')}`)
  }
})
