/**
 * Type-ahead tag suggestions for triage (grimoire Phase 7). Pure and
 * dependency-light so the seeker (Phase 8) can reuse the same scorer.
 */
import { makeTag, type Dimension } from './taxonomy'

export interface TagSuggestion {
  tag: string // normalized 'dim:value', or the free custom tag verbatim
  label: string // display label ('Tavern', or the custom tag itself)
  dimLabel?: string // 'Location' etc.; absent for custom tags
}

// Lower = better. Order: value-prefix > dimension-prefix > substring > subsequence.
const SCORE_VALUE_PREFIX = 0
const SCORE_DIM_PREFIX = 1
const SCORE_SUBSTRING = 2
const SCORE_SUBSEQUENCE = 3

/** True when every char of `q` appears in `s` in order (both lowercase). */
function isSubsequence(q: string, s: string): boolean {
  let i = 0
  for (const ch of s) {
    if (ch === q[i]) i++
    if (i === q.length) return true
  }
  return i === q.length
}

/** Best score of `q` against a value's slug + label (dimension handled separately). */
function scoreText(q: string, slugText: string, labelText: string): number | null {
  const slugL = slugText.toLowerCase()
  const labelL = labelText.toLowerCase()
  if (slugL.startsWith(q) || labelL.startsWith(q)) return SCORE_VALUE_PREFIX
  if (slugL.includes(q) || labelL.includes(q)) return SCORE_SUBSTRING
  if (isSubsequence(q, slugL) || isSubsequence(q, labelL)) return SCORE_SUBSEQUENCE
  return null
}

/**
 * Score every curated (dimension, value) pair plus the user's custom tags against
 * `query`, best-first; ties keep candidate order (dims in taxonomy order, curated
 * values in curated order, customs last). Empty query → nothing.
 */
export function suggestTags(
  query: string,
  dims: Dimension[],
  customTags: string[],
  limit = 8
): TagSuggestion[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const scored: { s: TagSuggestion; score: number; seq: number }[] = []
  let seq = 0

  for (const d of dims) {
    const dimPrefix =
      d.key.toLowerCase().startsWith(q) || d.label.toLowerCase().startsWith(q)
    for (const v of d.values) {
      const own = scoreText(q, v.value, v.label)
      const score = Math.min(own ?? Infinity, dimPrefix ? SCORE_DIM_PREFIX : Infinity)
      if (score !== Infinity) {
        scored.push({
          s: { tag: makeTag(d.key, v.value), label: v.label, dimLabel: d.label },
          score,
          seq: seq++
        })
      }
    }
  }
  for (const t of customTags) {
    const score = scoreText(q, t, t)
    if (score !== null) scored.push({ s: { tag: t, label: t }, score, seq: seq++ })
  }

  return scored
    .sort((a, b) => a.score - b.score || a.seq - b.seq)
    .slice(0, limit)
    .map((x) => x.s)
}
