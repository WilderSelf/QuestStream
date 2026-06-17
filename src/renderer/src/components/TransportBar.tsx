import { useStore, fmtTime } from '../store'

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
            onClick={toggleShuffle}
          >
            🔀
          </button>
          <button className="icon" title="Previous" onClick={() => void playPrev()}>
            ⏮
          </button>
          <button className="primary play" title="Play / Pause" onClick={() => void togglePlay()}>
            <span className={isPlaying ? '' : 'play-tri'}>{isPlaying ? '⏸' : '▶'}</span>
          </button>
          <button className="icon" title="Next" onClick={() => void playNext()}>
            ⏭
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
            onClick={cycleRepeat}
          >
            🔁
            {repeat === 'one' && <sup className="rep-badge">1</sup>}
          </button>
        </div>
        <div className="seek">
          <span className="time">{fmtTime(player.positionSec)}</span>
          <div className="bar" onClick={seek}>
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="time">{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="volume">
        <button
          className={`icon ${ducking ? 'toggled' : ''}`}
          title={ducking ? 'Narration duck ON — music lowered' : 'Duck music for narration'}
          onClick={() => setDuck(!ducking)}
        >
          🎙
        </button>
        <button
          className={`icon ${monitorEnabled ? 'toggled' : ''}`}
          title={
            monitorEnabled
              ? 'Local output ON — you hear the mix on this machine (mute to avoid doubling when in the call)'
              : 'Local output muted — audio only goes to Discord'
          }
          onClick={toggleMonitor}
        >
          {monitorEnabled ? '🎧' : '🔇'}
        </button>
        <span title="Master volume">🔈</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.volume}
          onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
        />
      </div>
    </div>
  )
}
