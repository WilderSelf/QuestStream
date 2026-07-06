import { useId } from 'react'
import { labelForDimension, labelForValue, makeTag, type TagValue } from '@shared/taxonomy'
import { colorForTag } from '@shared/tagColors'
import { Popover } from './Popover'
import { Icon } from './Icon'

/**
 * One dimension's filter control in the compact library filter bar: a button that opens a popover
 * of that dimension's colour chips. Filtering is single-select — the button shows either the
 * dimension label (unselected) or the chosen value as an inline colour pill with a ✕ to clear it.
 * Selecting a chip filters and closes; right-clicking a chip opens the colour picker (preserved
 * verbatim from the old inline chip rows).
 */
export function FacetFilter({
  dim,
  values,
  selected,
  tagColors,
  open,
  onOpen,
  onClose,
  onSelect,
  onRecolor
}: {
  dim: string
  values: TagValue[]
  selected: string | null
  tagColors: Record<string, string>
  open: boolean
  onOpen: () => void
  onClose: () => void
  onSelect: (value: string | null) => void
  onRecolor: (tag: string) => void
}): JSX.Element {
  const labelId = useId()
  const dimLabel = labelForDimension(dim)

  return (
    <Popover
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      labelledBy={labelId}
      trigger={({ triggerProps }) => {
        if (selected) {
          const tag = makeTag(dim, selected)
          const color = colorForTag(tag, tagColors)
          return (
            <button
              {...triggerProps}
              id={labelId}
              className="facet-btn selected"
              style={{ '--tag-color': color } as React.CSSProperties}
              aria-label={`${dimLabel}: ${labelForValue(dim, selected)} (selected)`}
            >
              {labelForValue(dim, selected)}
              <span
                className="facet-clear"
                role="button"
                aria-label={`Clear ${dimLabel} filter`}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(null)
                }}
              >
                <Icon name="x" size={12} />
              </span>
            </button>
          )
        }
        return (
          <button {...triggerProps} id={labelId} className="facet-btn">
            {dimLabel}
            <Icon name="chevron-down" size={14} />
          </button>
        )
      }}
    >
      {values.map((v) => {
        const on = selected === v.value
        const tag = makeTag(dim, v.value)
        const color = colorForTag(tag, tagColors)
        return (
          <button
            key={v.value}
            role="menuitemradio"
            aria-checked={on}
            className={`tag-chip ${on ? 'active' : ''}`}
            style={{ '--tag-color': color } as React.CSSProperties}
            title={`${v.label} — right-click to recolour`}
            onClick={() => {
              onSelect(on ? null : v.value)
              onClose()
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onRecolor(tag)
            }}
          >
            {v.label}
          </button>
        )
      })}
    </Popover>
  )
}
