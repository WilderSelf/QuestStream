import { useStore, fmtTime } from '../store'
import { Icon } from './Icon'

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

  const current = queue.find((q) => q.uid === currentUid)?.song
  const duration = current?.duration ?? player.durationSec ?? 0
  const pct = duration > 0 ? Math.min(100, (player.positionSec / duration) * 100) : 0
  // Treat buffering as "active" so the control shows ⏸ (the subtext shows "Buffering…").
  const isPlaying = player.state === 'playing' || player.state === 'buffering'

  function seek(e: React.MouseEvent<HTMLDivElement>): void {
    if (!current || duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    void seekTo(frac * duration)
  }

  // Keyboard seeking: arrows nudge ±5s, Home/End jump to start/end.
  function seekKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!current || duration <= 0) return
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : 0
    if (step) {
      e.preventDefault()
      void seekTo(Math.min(duration, Math.max(0, player.positionSec + step)))
    } else if (e.key === 'Home') {
      e.preventDefault()
      void seekTo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      void seekTo(duration)
    }
  }

  return (
    <div className="transport">
      <div className="np-info">
        {current?.thumbnail ? (
          <img className="thumb" src={current.thumbnail} alt="" />
        ) : (
          <div className="thumb" />
        )}
        <div className="meta">
          <div className="t">{current ? current.title : 'Nothing playing'}</div>
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
            <Icon name={isPlaying ? 'pause' : 'play'} size={20} />
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
        <div className="seek">
          <span className="time">{fmtTime(player.positionSec)}</span>
          <div
            className="bar"
            role="slider"
            tabIndex={current ? 0 : -1}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(player.positionSec)}
            aria-valuetext={`${fmtTime(player.positionSec)} of ${fmtTime(duration)}`}
            onClick={seek}
            onKeyDown={seekKey}
          >
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="time">{fmtTime(duration)}</span>
        </div>
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
        <span className="vol-icon" title="Master volume" aria-hidden="true">
          <Icon name="volume" size={16} />
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          aria-label="Master volume"
          value={player.volume}
          onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
        />
      </div>
    </div>
  )
}
