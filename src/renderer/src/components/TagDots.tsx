import { useStore } from '../store'
import { colorForTag } from '@shared/tagColors'
import { parseTag, labelForValue } from '@shared/taxonomy'

/** Display label for a tag: namespaced → its value label, free → the raw value. */
function tagLabel(tag: string): string {
  const { dim, value } = parseTag(tag)
  return dim ? labelForValue(dim, value) : value
}

/** Cap dots per card so a heavily-tagged track can't overflow the Now Playing row. */
const MAX_DOTS = 6

/**
 * A compact row of colour-coded tag markers for a Now Playing card: each tag is a coloured
 * circle at rest that expands into a labelled pill on hover / keyboard focus. Curated
 * (namespaced) tags are shown before free tags; any beyond the cap collapse into a "+N".
 */
export function TagDots({ tags }: { tags: string[] }): JSX.Element | null {
  const tagColors = useStore((s) => s.tagColors)
  if (!tags || tags.length === 0) return null

  // Namespaced tags first (they carry the meaningful colours), then free tags.
  const ordered = [...tags].sort((a, b) => Number(parseTag(b).dim != null) - Number(parseTag(a).dim != null))
  const shown = ordered.slice(0, MAX_DOTS)
  const extra = ordered.length - shown.length

  return (
    <div className="tag-dots">
      {shown.map((t) => {
        const label = tagLabel(t)
        return (
          <span
            key={t}
            className="tag-dots-item"
            style={{ '--tag-color': colorForTag(t, tagColors) } as React.CSSProperties}
            tabIndex={0}
            aria-label={label}
            title={label}
          >
            <span className="tag-dots-label">{label}</span>
          </span>
        )
      })}
      {extra > 0 && (
        <span className="tag-dots-more" aria-label={`${extra} more tags`} title={ordered.slice(MAX_DOTS).map(tagLabel).join(', ')}>
          +{extra}
        </span>
      )}
    </div>
  )
}
