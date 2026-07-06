import { useId } from 'react'
import { Modal } from './Modal'
import { useStore } from '../store'
import { NORD_SWATCHES, colorForTag } from '@shared/tagColors'
import { parseTag, labelForValue } from '@shared/taxonomy'

/** Display label for a tag: namespaced → its value label, free → the raw value. */
function tagDisplay(tag: string): string {
  const { dim, value } = parseTag(tag)
  return dim ? labelForValue(dim, value) : value
}

const sameHex = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * A small accessible dialog for recolouring a single tag: pick a Nord preset, dial in any
 * RGB value, or reset to the curated default. Changes apply live (and persist) as you click.
 */
export function TagColorPicker({ tag, onClose }: { tag: string; onClose: () => void }): JSX.Element {
  const tagColors = useStore((s) => s.tagColors)
  const setTagColor = useStore((s) => s.setTagColor)
  const resetTagColor = useStore((s) => s.resetTagColor)
  const current = colorForTag(tag, tagColors)
  const titleId = useId()

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="tag-color-modal">
      <h2 id={titleId} className="field-label tag-color-title">
        Colour for{' '}
        <span className="tag-color-name" style={{ color: current }}>
          {tagDisplay(tag)}
        </span>
      </h2>

      <div className="swatch-grid" role="group" aria-label="Preset colours">
        {NORD_SWATCHES.map((s) => (
          <button
            key={s.hex}
            className={`swatch ${sameHex(current, s.hex) ? 'active' : ''}`}
            style={{ background: s.hex }}
            title={s.name}
            aria-label={s.name}
            aria-pressed={sameHex(current, s.hex)}
            onClick={() => setTagColor(tag, s.hex)}
          />
        ))}
      </div>

      <div className="tag-color-custom">
        <label htmlFor={`${titleId}-rgb`}>Custom</label>
        <input
          id={`${titleId}-rgb`}
          type="color"
          value={current}
          onChange={(e) => setTagColor(tag, e.target.value)}
          aria-label="Custom colour"
        />
        <button className="link-btn" onClick={() => resetTagColor(tag)}>
          Reset to default
        </button>
      </div>

      <div className="tag-color-actions">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  )
}
