import { mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Write a file atomically: write to a temp sibling, then rename over the target, so a
 * crash mid-write can never leave a half-written file behind. Creates the parent dir.
 * Pass `mode` to chmod the file (e.g. 0o755 for an executable) before the rename.
 */
export function atomicWriteFile(
  path: string,
  data: string | NodeJS.ArrayBufferView,
  opts: { mode?: number } = {}
): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, data)
  if (opts.mode !== undefined) chmodSync(tmp, opts.mode)
  renameSync(tmp, path)
}
