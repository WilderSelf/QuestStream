import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

const MAX_THEME_BYTES = 512 * 1024 // a token-override sheet is a few KB; reject anything absurd

/** Where user-authored `.css` themes live (sibling of media/). */
export const themesDirFor = (userData: string): string => join(userData, 'themes')

/**
 * Ensure the themes folder exists and seed the author guide (THEME.md) once, so a user who opens
 * the folder always finds instructions + the token contract. Returns the folder path.
 */
export function ensureThemesDir(userData: string): string {
  const dir = themesDirFor(userData)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const guide = join(dir, 'THEME.md')
  if (!existsSync(guide)) writeFileSync(guide, THEME_GUIDE)
  return dir
}

/** List user theme stems (filename without `.css`), sorted. Empty if the folder is absent. */
export function listThemes(userData: string): string[] {
  const dir = themesDirFor(userData)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith('.css'))
      .map((n) => n.slice(0, -'.css'.length))
      .sort()
  } catch {
    return []
  }
}

/**
 * Read a user theme's CSS by stem. Resolves within the themes folder and rejects any name that
 * escapes it (path-traversal guard, mirroring the media-dir containment checks). Rejects files
 * over the size cap.
 */
export function readTheme(userData: string, name: string): string {
  const dir = themesDirFor(userData)
  const file = join(dir, `${name}.css`)
  const rel = relative(dir, file)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`invalid theme name: ${name}`)
  if (statSync(file).size > MAX_THEME_BYTES) throw new Error('theme file too large')
  return readFileSync(file, 'utf8')
}

const THEME_GUIDE = `# QuestStream themes

Drop a \`.css\` file in this folder and it appears in **Settings → Display → Theme**. A theme
overrides QuestStream's semantic design tokens — nothing else. Scope every rule to
\`:root[data-theme="<your-filename>"]\` (without the \`.css\`). Example — a file named
\`midnight.css\`:

\`\`\`css
:root[data-theme="midnight"] {
  /* --- surfaces (a rising elevation ramp: each lighter than the one below) --- */
  --bg: #0e1013;            /* deepest ground */
  --surface: #16191f;      /* panels */
  --surface-raised: #1f2530; /* cards, pane headers */
  --surface-over: #2a323f; /* modals, transport */
  --field-bg: #0b0d10;     /* recessed inputs / segmented wells */
  --border: rgba(230, 232, 236, 0.12);
  --border-strong: rgba(230, 232, 236, 0.2);
  --border-subtle: rgba(230, 232, 236, 0.07);
  --track: #3a3f4b;        /* slider / progress rails */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.35);
  --shadow-2: 0 6px 20px rgba(0, 0, 0, 0.45);
  --shadow-3: 0 20px 60px rgba(0, 0, 0, 0.55);

  /* --- text --- */
  --text: #e6e8ec;
  --text-dim: #9aa0ab;
  --text-faint: #6b727e;

  /* --- primary: the ONE action/emphasis colour --- */
  --primary: #e0a35c;
  --primary-hi: #edb877;   /* hover */
  --primary-press: #cf8f46;
  --primary-tint: rgba(224, 163, 92, 0.16);
  --on-primary: #16191f;   /* text ON a primary fill */

  /* --- semantic accents (never an action colour) --- */
  --live: #6ea8c0;         /* "sounding now" */
  --live-tint: rgba(110, 168, 192, 0.16);
  --accent-deep: #4b6ea0;
  --tag: #b48ead;          /* default tag colour */
  --danger: #bf616a;
  --danger-tint: rgba(191, 97, 106, 0.16);
  --warn: #ebcb8b;
  --ok: #a3be8c;
  --scrim: rgba(8, 9, 11, 0.62); /* modal backdrop */
  --on-tag: #16191f;       /* text ON a solid tag fill */
  --on-accent: #16191f;    /* text ON a cyan/accent fill */
  --on-solid: #eceff4;     /* bright text ON a deep/danger fill */
  --hover: rgba(230, 232, 236, 0.06);

  /* --- tag swatch palette (the 9 pickable tag colours + neutral) --- */
  --tag-red: #bf616a;
  --tag-orange: #d08770;
  --tag-yellow: #ebcb8b;
  --tag-green: #a3be8c;
  --tag-teal: #8fbcbb;
  --tag-cyan: #88c0d0;
  --tag-blue: #81a1c1;
  --tag-deepblue: #5e81ac;
  --tag-purple: #b48ead;
  --tag-neutral: #6b7280;
}
\`\`\`

Any token you omit falls back to the built-in **Nord Refined** value, so you can start small
(just the surfaces and primary) and add the rest as you like. On a **light** theme, remember to
darken \`--primary\`, \`--live\`, \`--danger\` and the tag swatches enough to stay readable, and set
the \`--on-*\` text tokens light.
`
