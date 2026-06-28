import { useEffect, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SoundboardItem } from '@shared/types'
import { useStore, fmtTime, type QueueItem, type AmbienceSlot } from '../store'
import { Icon } from './Icon'

function QueueRow({ item }: { item: QueueItem }): JSX.Element {
  const currentUid = useStore((s) => s.currentUid)
  const selectedUid = useStore((s) => s.selectedUid)
  const playerState = useStore((s) => s.player.state)
  const playUid = useStore((s) => s.playUid)
  const togglePlayUid = useStore((s) => s.togglePlayUid)
  const selectQueueItem = useStore((s) => s.selectQueueItem)
  const removeFromQueue = useStore((s) => s.removeFromQueue)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.uid
  })
  const isCurrent = currentUid === item.uid
  const isSelected = selectedUid === item.uid
  // 'buffering' counts as active (track is starting) — matches the transport bar.
  const isActive = isCurrent && (playerState === 'playing' || playerState === 'buffering')
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`row queue-item ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
      title="Click to select · double-click to play"
      onClick={() => selectQueueItem(item.uid)}
      onDoubleClick={() => void playUid(item.uid)}
    >
      <button
        className="play-btn"
        title={isActive ? 'Pause' : 'Play this track'}
        aria-label={isActive ? `Pause ${item.song.title}` : `Play ${item.song.title}`}
        onClick={(e) => {
          e.stopPropagation()
          void togglePlayUid(item.uid)
        }}
      >
        <Icon name={isActive ? 'pause' : 'play'} size={14} />
      </button>
      <span className="grip" {...attributes} {...listeners} title="Drag to reorder" aria-label="Drag to reorder">
        <Icon name="grip" size={16} />
      </span>
      {isActive ? (
        <span className="now-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : null}
      <div className="title">
        <div className="title">{item.song.title}</div>
        <div className="sub">{fmtTime(item.song.duration)}</div>
      </div>
      <button
        className="remove-btn"
        title="Remove"
        aria-label={`Remove ${item.song.title} from queue`}
        onClick={() => removeFromQueue(item.uid)}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  )
}

function AmbienceRow({ slot }: { slot: AmbienceSlot }): JSX.Element {
  const setAmbienceVolume = useStore((s) => s.setAmbienceVolume)
  const removeAmbience = useStore((s) => s.removeAmbience)
  const toggleAmbience = useStore((s) => s.toggleAmbience)
  const setAmbienceMode = useStore((s) => s.setAmbienceMode)
  const setAmbienceInterval = useStore((s) => s.setAmbienceInterval)
  // A per-slot drop target: dragging a song onto a layer adds it to that layer's
  // random pool (only meaningful in random mode, but harmless otherwise).
  const { setNodeRef, isOver } = useDroppable({ id: `ambslot:${slot.id}` })
  const random = slot.mode === 'random'
  const playing = slot.playing
  const poolCount = slot.pool.length
  return (
    <div
      ref={setNodeRef}
      className={`amb-card ${playing ? 'playing' : 'paused'} ${isOver ? 'drop-active' : ''}`}
    >
      <div className="amb-card-top">
        <button
          className="play-btn"
          title={playing ? 'Pause layer' : 'Play layer'}
          aria-label={playing ? `Pause ${slot.song.title}` : `Play ${slot.song.title}`}
          aria-pressed={playing}
          onClick={() => toggleAmbience(slot.id)}
        >
          <Icon name={playing ? 'pause' : 'play'} size={14} />
        </button>
        {playing ? (
          <span className="now-bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : null}
        <span className="amb-title" title={slot.song.title}>
          {random ? `Random · ${poolCount} sound${poolCount === 1 ? '' : 's'}` : slot.song.title}
        </span>
        <input
          type="range"
          className="amb-vol"
          min={0}
          max={1}
          step={0.01}
          value={slot.volume}
          title="Layer volume"
          aria-label={`Volume for ${slot.song.title}`}
          onChange={(e) => setAmbienceVolume(slot.id, parseFloat(e.target.value))}
        />
        <button
          className="remove-btn"
          title="Remove layer"
          aria-label={`Remove ${slot.song.title} layer`}
          onClick={() => removeAmbience(slot.id)}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="amb-card-controls">
        <div className="kind-tabs amb-mode" role="group" aria-label="Playback mode">
          <button
            className={`seg ${!random ? 'active' : ''}`}
            aria-pressed={!random}
            title="Play this layer as a continuous, seamless loop (rain, crowd, wind…)"
            onClick={() => setAmbienceMode(slot.id, 'loop')}
          >
            <Icon name="repeat" size={13} /> Loop
          </button>
          <button
            className={`seg ${random ? 'active' : ''}`}
            aria-pressed={random}
            title="Fire one random sound from this layer's pool at intervals (a wolf howl, a creaking timber)"
            onClick={() => setAmbienceMode(slot.id, 'random')}
          >
            <Icon name="dice" size={13} /> Random
          </button>
        </div>
        {random ? (
          <label
            className="amb-interval"
            title="Fires a random sound from this layer's pool every min–max seconds"
          >
            <span className="amb-interval-label">Every</span>
            <input
              type="number"
              min={1}
              aria-label="Minimum seconds between sounds"
              value={slot.minSec}
              onChange={(e) => setAmbienceInterval(slot.id, parseInt(e.target.value) || 1, slot.maxSec)}
            />
            <span>–</span>
            <input
              type="number"
              min={1}
              aria-label="Maximum seconds between sounds"
              value={slot.maxSec}
              onChange={(e) =>
                setAmbienceInterval(slot.id, slot.minSec, parseInt(e.target.value) || slot.minSec)
              }
            />
            <span className="amb-interval-label">sec</span>
          </label>
        ) : (
          <span className="amb-mode-hint">Continuous loop</span>
        )}
      </div>
      {random && <div className="amb-card-hint">Drag tracks here to grow the pool.</div>}
    </div>
  )
}

function AmbienceSection(): JSX.Element {
  const ambience = useStore((s) => s.ambience)
  const setKindTab = useStore((s) => s.setKindTab)
  const { setNodeRef, isOver } = useDroppable({ id: 'ambience-drop' })
  return (
    <div className="ambience">
      <div className="ambience-header">
        <span>Ambience layers · {ambience.length}</span>
        <button
          className="link-btn"
          title="Open the Ambience library to add a layer"
          onClick={() => setKindTab('ambience')}
        >
          Browse ambience →
        </button>
      </div>
      <div className={`ambience-list ${isOver ? 'drop-active' : ''}`} ref={setNodeRef}>
        {ambience.length === 0 && (
          <div className="muted small">
            Build a soundscape from layers that all play at once — e.g. a rain bed, a tavern
            crowd, and the occasional thunderclap. Drag an ambience track here (or double-click
            it) to add a layer, then set each layer to <strong>Loop</strong> (continuous) or{' '}
            <strong>Random</strong> (one-shots fired every few seconds).
          </div>
        )}
        {ambience.map((s) => (
          <AmbienceRow key={s.id} slot={s} />
        ))}
      </div>
    </div>
  )
}

function SoundboardButton({ item }: { item: SoundboardItem }): JSX.Element {
  const song = useStore((s) => s.library.songs.find((x) => x.id === item.songId))
  const triggerSfx = useStore((s) => s.triggerSfx)
  const [binding, setBinding] = useState(false)

  useEffect(() => {
    if (!binding) return
    // Suppress the global soundboard hotkey handler while capturing a new binding.
    const w = window as unknown as { __sbBinding?: boolean }
    w.__sbBinding = true
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      void window.api.soundboard.update(item.id, { hotkey: e.key === 'Escape' ? '' : e.key })
      setBinding(false)
    }
    window.addEventListener('keydown', onKey, { once: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      w.__sbBinding = false
    }
  }, [binding, item.id])

  return (
    <div className="sfx">
      <button className="sfx-trigger" title={song?.title ?? 'missing track'} onClick={() => triggerSfx(item.id)}>
        {song?.title ?? '— missing —'}
      </button>
      <button
        className={`icon sfx-key ${item.hotkey ? 'bound' : ''}`}
        title="Bind a hotkey"
        aria-label={
          binding
            ? 'Press a key to bind, or Escape to clear'
            : item.hotkey
              ? `Hotkey ${item.hotkey} — click to rebind`
              : 'Bind a hotkey'
        }
        aria-pressed={binding}
        onClick={() => setBinding(true)}
      >
        {binding ? '…' : item.hotkey || <Icon name="keyboard" size={16} />}
      </button>
      <button
        className={`icon sfx-duck ${item.duckUnderMusic ? 'on' : ''}`}
        title="Duck the music while this plays"
        aria-label="Duck the music while this plays"
        aria-pressed={item.duckUnderMusic}
        onClick={() => void window.api.soundboard.update(item.id, { duckUnderMusic: !item.duckUnderMusic })}
      >
        <Icon name="volume-low" size={16} />
      </button>
      <input
        type="range"
        className="sfx-gain"
        min={0}
        max={1}
        step={0.05}
        value={item.gain ?? 1}
        title="Sound volume"
        aria-label={`Volume for ${song?.title ?? 'sound'}`}
        onChange={(e) => void window.api.soundboard.update(item.id, { gain: parseFloat(e.target.value) })}
      />
      <button
        className="remove-btn"
        title="Remove"
        aria-label={`Remove ${song?.title ?? 'sound'} from soundboard`}
        onClick={() => void window.api.soundboard.remove(item.id)}
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  )
}

function SoundboardSection(): JSX.Element {
  const soundboard = useStore((s) => s.library.soundboard)
  const { setNodeRef, isOver } = useDroppable({ id: 'soundboard-drop' })
  return (
    <div className="ambience">
      <div className="ambience-header">
        <span>Soundboard · {soundboard.length}</span>
      </div>
      <div className={`sfx-grid ${isOver ? 'drop-active' : ''}`} ref={setNodeRef}>
        {soundboard.length === 0 && (
          <div className="muted small">
            Drag a track here to make a one-shot effect (door knock, sword clash). Bind a key to
            fire it instantly; the speaker toggle ducks the music while it plays.
          </div>
        )}
        {soundboard.map((item) => (
          <SoundboardButton key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

export function QueuePane(): JSX.Element {
  const queue = useStore((s) => s.queue)
  const ambience = useStore((s) => s.ambience)
  const clearQueue = useStore((s) => s.clearQueue)
  const setSavePromptOpen = useStore((s) => s.setSavePromptOpen)
  const setSaveScenePromptOpen = useStore((s) => s.setSaveScenePromptOpen)
  const musicVolume = useStore((s) => s.musicVolume)
  const setMusicVolume = useStore((s) => s.setMusicVolume)
  const { setNodeRef, isOver } = useDroppable({ id: 'queue-drop' })

  // Clearing a built queue throws away work — confirm unless it's already empty.
  function clearQueueConfirmed(): void {
    if (queue.length === 0 || confirm(`Clear the queue? ${queue.length} track(s) will be removed.`))
      clearQueue()
  }

  return (
    <div className="right-col">
      <div className={`pane queue ${isOver ? 'drop-active' : ''}`}>
      <div className="pane-header">
        <span>Now Playing · {queue.length}</span>
        <span className="header-actions">
          <button
            className="icon"
            disabled={queue.length === 0 && ambience.length === 0}
            title="Save as scene (music + ambience + volumes)"
            aria-label="Save as scene"
            onClick={() => setSaveScenePromptOpen(true)}
          >
            <Icon name="film" size={16} />
          </button>
          <button
            className="icon"
            disabled={queue.length === 0}
            title="Save queue as playlist"
            aria-label="Save queue as playlist"
            onClick={() => setSavePromptOpen(true)}
          >
            <Icon name="save" size={16} />
          </button>
          <button
            className="icon"
            disabled={queue.length === 0}
            title="Clear queue"
            aria-label="Clear queue"
            onClick={clearQueueConfirmed}
          >
            <Icon name="trash" size={16} />
          </button>
        </span>
      </div>

      <div className="deck-row" title="Music layer volume (relative to ambience)">
        <span className="vol-icon" aria-hidden="true">
          <Icon name="music" size={16} />
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          aria-label="Music layer volume"
          value={musicVolume}
          onChange={(e) => setMusicVolume(parseFloat(e.target.value))}
        />
      </div>

      <div className="pane-body" ref={setNodeRef}>
        {queue.length === 0 && (
          <div className="muted">
            Drag songs here (or double-click them) to build a queue. Reorder by dragging the grip
            handle, then save it as a playlist.
          </div>
        )}
        <SortableContext items={queue.map((q) => q.uid)} strategy={verticalListSortingStrategy}>
          {queue.map((item) => (
            <QueueRow key={item.uid} item={item} />
          ))}
        </SortableContext>
      </div>

      </div>

      <div className="pane mixer">
        <div className="pane-header">
          <span>Mixer · live layers</span>
        </div>
        <AmbienceSection />
        <SoundboardSection />
      </div>
    </div>
  )
}
