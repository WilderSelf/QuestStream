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
        {isActive ? '⏸' : '▶'}
      </button>
      <span className="grip" {...attributes} {...listeners} title="Drag to reorder" aria-label="Drag to reorder">
        <span aria-hidden="true">⋮⋮</span>
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
        ✕
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
  return (
    <div
      ref={setNodeRef}
      className={`amb-slot ${slot.playing ? '' : 'paused'} ${isOver ? 'drop-active' : ''}`}
      title={slot.song.title}
    >
      <button
        className="icon amb-play"
        title={slot.playing ? 'Pause layer' : 'Play layer'}
        aria-label={slot.playing ? 'Pause layer' : 'Play layer'}
        aria-pressed={slot.playing}
        onClick={() => toggleAmbience(slot.id)}
      >
        {slot.playing ? '⏸' : '▶'}
      </button>
      <button
        className="icon"
        title={random ? 'Random one-shots — click for a seamless loop' : 'Looping — click for random one-shots'}
        aria-label={random ? 'Mode: random one-shots' : 'Mode: looping'}
        onClick={() => setAmbienceMode(slot.id, random ? 'loop' : 'random')}
      >
        {random ? '🎲' : '🔁'}
      </button>
      <span className="amb-title">
        {random ? `${slot.pool.length} sound${slot.pool.length > 1 ? 's' : ''}` : slot.song.title}
      </span>
      {random && (
        <span className="amb-interval" title="Fire a random sound every N–M seconds">
          <input
            type="number"
            min={1}
            aria-label="Minimum interval (seconds)"
            value={slot.minSec}
            onChange={(e) => setAmbienceInterval(slot.id, parseInt(e.target.value) || 1, slot.maxSec)}
          />
          –
          <input
            type="number"
            min={1}
            aria-label="Maximum interval (seconds)"
            value={slot.maxSec}
            onChange={(e) => setAmbienceInterval(slot.id, slot.minSec, parseInt(e.target.value) || slot.minSec)}
          />
          s
        </span>
      )}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={slot.volume}
        title="Layer volume"
        aria-label="Layer volume"
        onChange={(e) => setAmbienceVolume(slot.id, parseFloat(e.target.value))}
      />
      <button
        className="remove-btn"
        title="Remove layer"
        aria-label="Remove ambience layer"
        onClick={() => removeAmbience(slot.id)}
      >
        ✕
      </button>
    </div>
  )
}

function AmbienceSection(): JSX.Element {
  const ambience = useStore((s) => s.ambience)
  const { setNodeRef, isOver } = useDroppable({ id: 'ambience-drop' })
  return (
    <div className="ambience">
      <div className="ambience-header">
        <span>Ambience layers · {ambience.length}</span>
      </div>
      <div className={`ambience-list ${isOver ? 'drop-active' : ''}`} ref={setNodeRef}>
        {ambience.length === 0 && (
          <div className="muted small">
            Drag a track here to loop it under your music (rain, crowd, wind…). Toggle 🔁→🎲 to
            make a layer fire random one-shots at intervals (a wolf howl, a creaking timber);
            drag more tracks onto it to grow its pool.
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
        {binding ? '…' : item.hotkey || '⌨'}
      </button>
      <button
        className={`icon sfx-duck ${item.duckUnderMusic ? 'on' : ''}`}
        title="Duck the music while this plays"
        aria-label="Duck the music while this plays"
        aria-pressed={item.duckUnderMusic}
        onClick={() => void window.api.soundboard.update(item.id, { duckUnderMusic: !item.duckUnderMusic })}
      >
        🔉
      </button>
      <button
        className="remove-btn"
        title="Remove"
        aria-label={`Remove ${song?.title ?? 'sound'} from soundboard`}
        onClick={() => void window.api.soundboard.remove(item.id)}
      >
        ✕
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
            Drag a track here to make a one-shot effect (door knock, sword clash). Bind a key
            (⌨) to fire it instantly; 🔉 ducks the music while it plays.
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
            🎬
          </button>
          <button
            className="icon"
            disabled={queue.length === 0}
            title="Save queue as playlist"
            aria-label="Save queue as playlist"
            onClick={() => setSavePromptOpen(true)}
          >
            💾
          </button>
          <button
            className="icon"
            disabled={queue.length === 0}
            title="Clear queue"
            aria-label="Clear queue"
            onClick={clearQueueConfirmed}
          >
            🗑
          </button>
        </span>
      </div>

      <div className="deck-row" title="Music layer volume (relative to ambience)">
        <span aria-hidden="true">🎵</span>
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
            Drag songs here (or double-click them) to build a queue. Reorder by dragging the ⋮⋮
            handle, then save it as a playlist.
          </div>
        )}
        <SortableContext items={queue.map((q) => q.uid)} strategy={verticalListSortingStrategy}>
          {queue.map((item) => (
            <QueueRow key={item.uid} item={item} />
          ))}
        </SortableContext>
      </div>

      <AmbienceSection />
      <SoundboardSection />
    </div>
  )
}
