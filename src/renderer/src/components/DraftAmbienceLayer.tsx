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
const INTERVAL_STEP_SEC = 5

export function DraftAmbienceLayer({ layer, index }: { layer: DraftLayer; index: number }): JSX.Element {
  const builderKey = useStore((s) => s.builderKey)!
  const editDraft = useStore((s) => s.editDraft)
  const song = useStore((s) => s.library.songs.find((x) => x.id === layer.songId))

  const setInterval_ = (minSec: number, maxSec: number): void =>
    editDraft(builderKey, { type: 'set-layer-interval', index, minSec, maxSec })

  return (
    <div className="draft-layer">
      <div className="draft-layer-head">
        <span className="draft-layer-name">
          <span className={`song-title ${song ? '' : 'missing'}`}>
            {song?.title ?? 'Missing item'}
          </span>
          <span className="draft-layer-caption">
            {layer.mode === 'random' ? 'plays once in a while' : 'plays continuously'}
          </span>
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
        <div className="draft-layer-interval draft-pill">
          every
          <button
            className="icon"
            title="Shorter minimum wait"
            aria-label="Shorter minimum wait"
            disabled={layer.minIntervalSec <= INTERVAL_STEP_SEC}
            onClick={() => setInterval_(layer.minIntervalSec - INTERVAL_STEP_SEC, layer.maxIntervalSec)}
          >
            −
          </button>
          <b>{layer.minIntervalSec}</b>
          <button
            className="icon"
            title="Longer minimum wait"
            aria-label="Longer minimum wait"
            onClick={() => setInterval_(layer.minIntervalSec + INTERVAL_STEP_SEC, layer.maxIntervalSec)}
          >
            +
          </button>
          to
          <button
            className="icon"
            title="Shorter maximum wait"
            aria-label="Shorter maximum wait"
            disabled={layer.maxIntervalSec <= layer.minIntervalSec}
            onClick={() => setInterval_(layer.minIntervalSec, layer.maxIntervalSec - INTERVAL_STEP_SEC)}
          >
            −
          </button>
          <b>{layer.maxIntervalSec}</b>
          <button
            className="icon"
            title="Longer maximum wait"
            aria-label="Longer maximum wait"
            onClick={() => setInterval_(layer.minIntervalSec, layer.maxIntervalSec + INTERVAL_STEP_SEC)}
          >
            +
          </button>
          s
        </div>
      )}
    </div>
  )
}
