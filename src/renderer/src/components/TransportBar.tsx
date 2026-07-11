import { useStore } from '../store'
import { Icon } from './Icon'
import { SeekBar } from './SeekBar'
import { VolumeSlider } from './VolumeSlider'

export function TransportBar(): JSX.Element {
  const player = useStore((s) => s.player)
  const queue = useStore((s) => s.queue)
  const currentUid = useStore((s) => s.currentUid)
  const togglePlay = useStore((s) => s.togglePlay)
  const playNext = useStore((s) => s.playNext)
  const playPrev = useStore((s) => s.playPrev)
  const shuffle = useStore((s) => s.shuffle)
  const repeat = useStore((s) => s.repeat)
  const toggleShuffle = useStore((s) => s.toggleShuffle)
  const cycleRepeat = useStore((s) => s.cycleRepeat)
  const monitorEnabled = useStore((s) => s.monitorEnabled)
  const toggleMonitor = useStore((s) => s.toggleMonitor)
  const ducking = useStore((s) => s.ducking)
  const setDuck = useStore((s) => s.setDuck)
  const seekTo = useStore((s) => s.seekTo)
  const setMasterVolume = useStore((s) => s.setMasterVolume)
  const monitorVolume = useStore((s) => s.monitorVolume)
  const setMonitorVolume = useStore((s) => s.setMonitorVolume)

  const current = queue.find((q) => q.uid === currentUid)?.song
  const duration = current?.duration ?? player.durationSec ?? 0
  // Treat buffering as "active" so the control shows ⏸ (the subtext shows "Buffering…").
  const isPlaying = player.state === 'playing' || player.state === 'buffering'

  return (
    <div className="transport">
      <div className="np-info">
        {current?.thumbnail ? (
          <img className="thumb" src={current.thumbnail} alt="" />
        ) : (
          <div className="thumb" />
        )}
        <div className="meta">
          <div className="t" title={current ? current.title : undefined}>
            {current ? current.title : 'Nothing playing'}
          </div>
          <div className="a">
            {current
              ? player.state === 'buffering'
                ? 'Buffering…'
                : 'Streaming to voice'
              : 'Queue a track to begin'}
          </div>
        </div>
      </div>

      <div className="controls">
        <div className="control-buttons">
          <button
            className={`icon ${shuffle ? 'toggled' : ''}`}
            title={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
            aria-label={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
            aria-pressed={shuffle}
            onClick={toggleShuffle}
          >
            <Icon name="shuffle" />
          </button>
          <button className="icon" title="Previous" aria-label="Previous track" onClick={() => void playPrev()}>
            <Icon name="prev" />
          </button>
          <button
            className="primary play"
            title="Play / Pause"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            onClick={() => void togglePlay()}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={18} />
          </button>
          <button className="icon" title="Next" aria-label="Next track" onClick={() => void playNext()}>
            <Icon name="next" />
          </button>
          <button
            className={`icon repeat ${repeat !== 'off' ? 'toggled' : ''}`}
            title={
              repeat === 'off'
                ? 'Repeat: off'
                : repeat === 'all'
                  ? 'Repeat: all tracks'
                  : 'Repeat: this track'
            }
            aria-label={
              repeat === 'off'
                ? 'Repeat: off'
                : repeat === 'all'
                  ? 'Repeat: all tracks'
                  : 'Repeat: this track'
            }
            aria-pressed={repeat !== 'off'}
            onClick={cycleRepeat}
          >
            <Icon name="repeat" />
            {repeat === 'one' && <sup className="rep-badge">1</sup>}
          </button>
        </div>
        <SeekBar
          positionSec={player.positionSec}
          duration={duration}
          enabled={!!current}
          onSeek={(sec) => void seekTo(sec)}
        />
      </div>

      <div className="volume">
        <button
          className={`icon icon-text ${ducking ? 'toggled' : ''}`}
          title={
            ducking
              ? 'Narration duck ON — music auto-lowers while a sound plays'
              : 'Auto-lower the music while a sound plays (narration duck)'
          }
          aria-label={ducking ? 'Narration duck: on' : 'Narration duck: off'}
          aria-pressed={ducking}
          onClick={() => setDuck(!ducking)}
        >
          <Icon name="mic" size={16} /> <span className="ctl-label">Duck</span>
        </button>
        <button
          className={`icon icon-text ${monitorEnabled ? 'toggled' : ''}`}
          title={
            monitorEnabled
              ? 'Local output ON — you hear the mix on this machine (mute to avoid doubling when in the call)'
              : 'Local output muted — audio only goes to Discord'
          }
          aria-label={monitorEnabled ? 'Local output: on' : 'Local output: muted'}
          aria-pressed={monitorEnabled}
          onClick={toggleMonitor}
        >
          <Icon name={monitorEnabled ? 'headphones' : 'volume-mute'} size={16} />{' '}
          <span className="ctl-label">Monitor</span>
        </button>
        <span className="vol-icon" title="Local monitor volume — what you hear on this machine" aria-hidden="true">
          <Icon name="headphones" size={16} />
        </span>
        <VolumeSlider
          ariaLabel="Local monitor volume"
          title="Local monitor volume — what you hear on this machine"
          value={monitorVolume}
          onChange={setMonitorVolume}
        />
        <span className="vol-icon" title="Discord send volume — what remote players hear" aria-hidden="true">
          <Icon name="volume" size={16} />
        </span>
        <VolumeSlider
          ariaLabel="Discord send volume"
          title="Discord send volume — what remote players hear"
          value={player.volume}
          onChange={setMasterVolume}
        />
      </div>
    </div>
  )
}
