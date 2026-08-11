import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { ScenePad } from '@shared/types'
import { Icon } from './Icon'
import { VolumeSlider } from './VolumeSlider'

/**
 * Per-scene sound pads: one-shots that join the margin's soundboard while this
 * scene is live (Phase 5). Same controls as the global soundboard — hotkey,
 * duck-under-music, gain — but stored on the scene document via reduceDraft.
 */
function PadCard({ pad, index }: { pad: ScenePad; index: number }): JSX.Element {
  const builderKey = useStore((s) => s.builderKey)!
  const editDraft = useStore((s) => s.editDraft)
  const song = useStore((s) => s.library.songs.find((x) => x.id === pad.songId))
  const [binding, setBinding] = useState(false)

  useEffect(() => {
    if (!binding) return
    // Same capture pattern as the global soundboard: swallow the next keydown as
    // the binding (Escape clears), suppressing the global hotkey handler meanwhile.
    const w = window as unknown as { __sbBinding?: boolean }
    w.__sbBinding = true
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      editDraft(builderKey, {
        type: 'set-pad',
        index,
        patch: { hotkey: e.key === 'Escape' ? undefined : e.key }
      })
      setBinding(false)
    }
    window.addEventListener('keydown', onKey, { once: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      w.__sbBinding = false
    }
  }, [binding, builderKey, editDraft, index])

  return (
    <div className="sfx sigil draft-pad">
      <span className="sfx-trigger draft-pad-name" title={song?.title ?? 'missing track'}>
        {song?.title ?? '— missing —'}
      </span>
      <button
        className={`icon sfx-key ${pad.hotkey ? 'bound' : ''}`}
        title="Bind a hotkey"
        aria-label={
          binding
            ? 'Press a key to bind, or Escape to clear'
            : pad.hotkey
              ? `Hotkey ${pad.hotkey} — click to rebind`
              : 'Bind a hotkey'
        }
        aria-pressed={binding}
        onClick={() => setBinding(true)}
      >
        {binding ? '…' : pad.hotkey || <Icon name="keyboard" size={16} />}
      </button>
      <button
        className={`icon sfx-duck ${pad.duckUnderMusic ? 'on' : ''}`}
        title="Duck the music while this plays"
        aria-label="Duck the music while this plays"
        aria-pressed={!!pad.duckUnderMusic}
        onClick={() =>
          editDraft(builderKey, { type: 'set-pad', index, patch: { duckUnderMusic: !pad.duckUnderMusic } })
        }
      >
        <Icon name="volume-low" size={16} />
      </button>
      <VolumeSlider
        className="sfx-gain"
        step={0.05}
        value={pad.gain ?? 1}
        title="Pad volume"
        ariaLabel={`Volume for ${song?.title ?? 'pad'}`}
        onChange={(v) => editDraft(builderKey, { type: 'set-pad', index, patch: { gain: v } })}
      />
      <button
        className="remove-btn"
        title="Remove pad"
        aria-label={`Remove ${song?.title ?? 'pad'} from scene`}
        onClick={() => editDraft(builderKey, { type: 'remove-pad', index })}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  )
}

export function DraftPadGrid({ pads }: { pads: ScenePad[] }): JSX.Element {
  if (pads.length === 0) {
    return (
      <div className="muted small">
        No pads for this scene — drag a sound from the library palette to add one.
      </div>
    )
  }
  return (
    <div className="draft-pad-grid">
      {pads.map((p, i) => (
        <PadCard key={`${p.songId}:${i}`} pad={p} index={i} />
      ))}
    </div>
  )
}
