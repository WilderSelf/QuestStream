// Node ESM resolve hook: lets the source's extensionless relative imports
// (written for electron-vite's bundler resolution, e.g. `./binaries`) resolve to
// their `.ts` files when running under `node --test --experimental-transform-types`.
// Keeps the test harness dependency-free (no tsx/vitest/esbuild needed).
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
  const hasExt = /\.[mc]?[jt]sx?$/.test(specifier)
  if (isRelative && !hasExt && context.parentURL) {
    try {
      const asFile = fileURLToPath(new URL(specifier, context.parentURL))
      if (!existsSync(asFile) && existsSync(`${asFile}.ts`)) {
        return nextResolve(`${specifier}.ts`, context)
      }
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context)
}
