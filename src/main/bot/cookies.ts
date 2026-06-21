import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { COOKIE_BROWSERS, type CookieBrowser } from '../../shared/types'

/** Imported Netscape-format cookies.txt lives here, under the writable userData dir. */
export const cookiesFilePath = (userData: string): string => join(userData, 'cookies.txt')

/** Validate an untrusted browser name against the allow-list (prevents arg injection). */
export function isCookieBrowser(name: string): name is CookieBrowser {
  return (COOKIE_BROWSERS as readonly string[]).includes(name)
}

/**
 * The yt-dlp cookie arguments for the current setting. Empty when cookies are off (or a
 * file mode with no imported file yet). These are prepended before the `--` URL guard.
 */
export function buildCookieArgs(opts: {
  mode: 'none' | 'file' | 'browser'
  browser?: string
  userData: string
}): string[] {
  if (opts.mode === 'file') {
    const p = cookiesFilePath(opts.userData)
    return existsSync(p) ? ['--cookies', p] : []
  }
  if (opts.mode === 'browser' && opts.browser && isCookieBrowser(opts.browser)) {
    return ['--cookies-from-browser', opts.browser]
  }
  return []
}
