import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopStatus } from '../shared/types'

const APP_ID = 'io.github.WilderSelf.QuestStream'
const APP_NAME = 'QuestStream'

const appsDir = (): string => join(homedir(), '.local', 'share', 'applications')
const iconsDir = (): string => join(homedir(), '.local', 'share', 'icons')
const desktopFile = (): string => join(appsDir(), `${APP_ID}.desktop`)
const iconFile = (): string => join(iconsDir(), `${APP_ID}.png`)

/**
 * The path to the running .AppImage, if we're running as one. AppImage's runtime sets
 * APPIMAGE to the bundle path (the thing we want a menu entry to launch). Null otherwise
 * (dev, or a non-AppImage package), in which case self-install doesn't apply.
 */
function appImagePath(): string | null {
  const p = process.env.APPIMAGE
  return p && existsSync(p) ? p : null
}

/**
 * Quote a path for a Desktop Entry `Exec=` value. Wraps in double quotes and backslash-escapes
 * the reserved-inside-quotes characters (`"` `` ` `` `$` `\`) per the Desktop Entry spec, so a
 * `"` or `$` in the AppImage path can't break out of the quoting or inject a field code.
 */
function quoteExec(p: string): string {
  return `"${p.replace(/(["`$\\])/g, '\\$1')}"`
}

export function desktopStatus(): DesktopStatus {
  return { isAppImage: !!appImagePath(), installed: existsSync(desktopFile()) }
}

/**
 * Write a Desktop Entry + icon into the user's local data dirs so QuestStream shows up
 * in the applications menu. AppImages aren't registered automatically (unless the user
 * runs AppImageLauncher), so we offer this as a one-click action.
 */
export function installDesktopEntry(): { ok: boolean; error?: string } {
  const appImage = appImagePath()
  if (!appImage) return { ok: false, error: 'Not running as an AppImage.' }
  // Control characters would corrupt the single-line Exec key; refuse rather than emit them.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(appImage)) {
    return { ok: false, error: 'AppImage path contains invalid characters.' }
  }
  try {
    mkdirSync(appsDir(), { recursive: true })
    mkdirSync(iconsDir(), { recursive: true })

    // Bundled icon → user icon dir (best-effort; the entry still works without it).
    const iconSrc = join(process.resourcesPath, 'icon.png')
    let iconRef = APP_NAME
    if (existsSync(iconSrc)) {
      copyFileSync(iconSrc, iconFile())
      iconRef = iconFile()
    }

    const entry =
      `[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Bring-your-own-audio mixer for tabletop GMs
Exec=${quoteExec(appImage)} %U
Icon=${iconRef}
Terminal=false
Categories=AudioVideo;Audio;
StartupWMClass=${APP_NAME}
` // trailing newline matters for some parsers
    writeFileSync(desktopFile(), entry, 'utf8')
    chmodSync(desktopFile(), 0o755)

    // Best-effort: refresh the menu database so it appears without a re-login.
    try {
      spawn('update-desktop-database', [appsDir()], { stdio: 'ignore' }).on('error', () => {})
    } catch {
      /* not fatal — most DEs pick up the file on their own */
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
