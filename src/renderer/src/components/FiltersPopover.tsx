import { useId, useState } from 'react'
import { labelForDimension, makeTag, type TagValue } from '@shared/taxonomy'
import { colorForTag } from '@shared/tagColors'
import { useStore } from '../store'
import { Popover } from './Popover'
import { Icon } from './Icon'

export interface FilterRow {
  dim: string
  values: TagValue[]
}

/**
 * The library's secondary facet filters, consolidated behind one "Filters (n)" button so the
 * filter bar stays a single non-wrapping row at small window sizes (was one button per dimension,
 * which wrapped to a second row ~65px tall at ~960×520). Opening it reveals every dimension as a
 * labelled group of colour chips in a single popover panel. Filtering is single-select per
 * dimension; selecting keeps the panel open so several facets can be set in one visit. Right-click
 * a chip to recolour it (preserved verbatim from the old per-facet rows).
 */
export function FiltersPopover({
  rows,
  filters,
  tagColors,
  activeCount,
  onSelect,
  onRecolor
}: {
  rows: FilterRow[]
  filters: Record<string, string | null>
  tagColors: Record<string, string>
  activeCount: number
  onSelect: (dim: string, value: string | null) => void
  onRecolor: (tag: string) => void
}): JSX.Element {
  const labelId = useId()
  const themeSwatches = useStore((s) => s.themeSwatches)
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      labelledBy={labelId}
      trigger={({ triggerProps }) => (
        <button
          {...triggerProps}
          id={labelId}
          className={`facet-btn ${activeCount > 0 ? 'has-active' : ''}`}
          aria-label={activeCount > 0 ? `Filters (${activeCount} active)` : 'Filters'}
        >
          <Icon name="filter" size={13} />
          Filters
          {activeCount > 0 && <span className="facet-count">{activeCount}</span>}
          <Icon name="chevron-down" size={14} />
        </button>
      )}
    >
      {rows.map(({ dim, values }) => (
        // role="group" keeps each dimension a distinct single-select radio group; without it,
        // assistive tech reads all dimensions' menuitemradios as one shared group.
        <div className="facet-group" role="group" aria-label={labelForDimension(dim)} key={dim}>
          <div className="facet-group-label">{labelForDimension(dim)}</div>
          <div className="facet-group-chips">
            {values.map((v) => {
              const on = filters[dim] === v.value
              const tag = makeTag(dim, v.value)
              const color = colorForTag(tag, tagColors, themeSwatches)
              return (
                <button
                  key={v.value}
                  role="menuitemradio"
                  aria-checked={on}
                  className={`tag-chip ${on ? 'active' : ''}`}
                  style={{ '--tag-color': color } as React.CSSProperties}
                  title={`${v.label} — right-click to recolour`}
                  onClick={() => onSelect(dim, on ? null : v.value)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    onRecolor(tag)
                  }}
                >
                  {v.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </Popover>
  )
}
