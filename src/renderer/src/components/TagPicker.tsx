import { useState } from 'react'
import { useStore } from '../store'
import { Icon } from './Icon'
import type { ItemKind } from '@shared/types'
import { dimensionsFor, makeTag, normalizeTag, parseTag } from '@shared/taxonomy'
import { colorForTag } from '@shared/tagColors'

/** Pick namespaced tags for one item, grouped by the kind's dimensions, + a custom field. */
export function TagPicker({
  kind,
  value,
  onChange
}: {
  kind: ItemKind
  value: string[]
  onChange: (tags: string[]) => void
}): JSX.Element {
  const [custom, setCustom] = useState('')
  const tagColors = useStore((s) => s.tagColors)
  const themeSwatches = useStore((s) => s.themeSwatches)
  const has = (tag: string): boolean => value.some((t) => t.toLowerCase() === tag.toLowerCase())
  const toggle = (tag: string): void =>
    onChange(has(tag) ? value.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...value, tag])
  const addCustom = (): void => {
    const t = normalizeTag(custom)
    if (t && !has(t)) onChange([...value, t])
    setCustom('')
  }
  const free = value.filter((t) => !parseTag(t).dim)

  return (
    <div className="tag-picker">
      {dimensionsFor(kind).map((d) => (
        <div className="filter-row" key={d.key}>
          <span className="filter-label">{d.label}</span>
          {d.values.map((v) => {
            const tag = makeTag(d.key, v.value)
            return (
              <button
                key={v.value}
                className={`tag-chip ${has(tag) ? 'active' : ''}`}
                style={{ '--tag-color': colorForTag(tag, tagColors, themeSwatches) } as React.CSSProperties}
                onClick={() => toggle(tag)}
              >
                {v.label}
              </button>
            )
          })}
        </div>
      ))}
      <div className="filter-row">
        <span className="filter-label">Custom</span>
        {free.map((t) => (
          <span
            key={t}
            className="tag-chip active tag-removable"
            style={{ '--tag-color': colorForTag(t, tagColors, themeSwatches) } as React.CSSProperties}
            onClick={() => toggle(t)}
          >
            {t} <Icon name="x" size={11} />
          </span>
        ))}
        <input
          className="custom-tag"
          value={custom}
          placeholder="add a tag, Enter"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addCustom()
            }
          }}
        />
      </div>
    </div>
  )
}
