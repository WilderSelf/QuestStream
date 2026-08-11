import { useStore } from '../store'
import type { DraftLayer } from '@shared/scene-edit'
import type { AmbienceMode } from '@shared/types'
import { Icon } from './Icon'
import { SegmentedControl } from './SegmentedControl'
import { VolumeSlider } from './VolumeSlider'

/**
 * One editable ambience layer in the scene builder. Loop layers play continuously;
 * Random layers fire one-shots every min–max seconds. All edits go through
 * reduceDraft — nothing here can reach the live ambience mixer.
 */
export function DraftAmbienceLayer({ layer, index }: { layer: DraftLayer; index: number }): JSX.Element {
  const builderKey = useStore((s) => s.builderKey)!
  const editDraft = useStore((s) => s.editDraft)
  const song = useStore((s) => s.library.songs.find((x) => x.id === layer.songId))

  const setInterval_ = (minSec: number, maxSec: number): void =>
    editDraft(builderKey, { type: 'set-layer-interval', index, minSec, maxSec })

  return (
    <div className="draft-layer">
      <div className="draft-layer-head">
        <span className={`song-title ${song ? '' : 'missing'}`}>
          {song?.title ?? 'Missing item'}
        </span>
        <SegmentedControl<AmbienceMode>
          options={[
            { value: 'loop', label: 'Loop' },
            { value: 'random', label: 'Random' }
          ]}
          value={layer.mode}
          onChange={(mode) => editDraft(builderKey, { type: 'set-layer-mode', index, mode })}
        />
        <VolumeSlider
          className="draft-layer-gain"
          step={0.05}
          value={layer.volume}
          title="Layer volume"
          ariaLabel={`Volume for ${song?.title ?? 'layer'}`}
          onChange={(v) => editDraft(builderKey, { type: 'set-layer-volume', index, volume: v })}
        />
        <button
          className="remove-btn"
          title="Remove layer"
          aria-label={`Remove ${song?.title ?? 'layer'} from scene`}
          onClick={() => editDraft(builderKey, { type: 'remove-layer', index })}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      {layer.mode === 'random' && (
        <div className="draft-layer-interval">
          <span className="builder-label">Plays once every</span>
          <input
            type="number"
            min={1}
            value={layer.minIntervalSec}
            aria-label="Minimum seconds between plays"
            onChange={(e) => setInterval_(Number(e.target.value), layer.maxIntervalSec)}
          />
          <span className="builder-label">to</span>
          <input
            type="number"
            min={layer.minIntervalSec}
            value={layer.maxIntervalSec}
            aria-label="Maximum seconds between plays"
            onChange={(e) => setInterval_(layer.minIntervalSec, Number(e.target.value))}
          />
          <span className="builder-label">seconds</span>
        </div>
      )}
    </div>
  )
}
