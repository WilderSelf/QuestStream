import { useEffect } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useStore } from './store'
import { TopBar } from './components/TopBar'
import { PlaylistsPane } from './components/Browser'
import { LibraryPane } from './components/LibraryPane'
import { QueuePane } from './components/QueuePane'
import { TransportBar } from './components/TransportBar'
import {
  SettingsModal,
  SavePlaylistModal,
  SaveSceneModal,
  SongEditModal,
  DisclaimerModal
} from './components/Modals'
import { ImportWizardModal } from './components/ImportWizard'
import { AlertBanner } from './components/AlertBanner'
import { DesktopPrompt } from './components/DesktopPrompt'
import { UpdateBanner } from './components/UpdateBanner'
import { Toast } from './components/Toast'

export function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const queue = useStore((s) => s.queue)
  const library = useStore((s) => s.library)
  const enqueueSongs = useStore((s) => s.enqueueSongs)
  const reorderQueue = useStore((s) => s.reorderQueue)
  const addAmbience = useStore((s) => s.addAmbience)
  const addAmbiencePoolSong = useStore((s) => s.addAmbiencePoolSong)

  useEffect(() => {
    void init()
  }, [init])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard alternative to dragging: focus a grip/row, Space to pick up, arrows to move.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function onDragEnd(e: DragEndEvent): void {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    // Dragging a library song somewhere
    if (activeId.startsWith('song:')) {
      const songId = activeId.slice('song:'.length)
      const song = library.songs.find((s) => s.id === songId)
      if (!song) return
      // ...onto the ambience area → new looping layer
      if (overId === 'ambience-drop') {
        addAmbience(song)
        return
      }
      // ...onto an existing layer → add to that layer's random pool
      if (overId.startsWith('ambslot:')) {
        addAmbiencePoolSong(overId.slice('ambslot:'.length), song)
        return
      }
      // ...onto the soundboard → new one-shot effect
      if (overId === 'soundboard-drop') {
        void window.api.soundboard.add(song.id)
        return
      }
      // ...otherwise into the music queue
      let index = queue.length
      if (overId !== 'queue-drop') {
        const at = queue.findIndex((q) => q.uid === overId)
        if (at >= 0) index = at
      }
      enqueueSongs([song], index)
      return
    }

    // Reordering within the queue
    if (activeId !== overId && overId !== 'queue-drop') {
      const from = queue.findIndex((q) => q.uid === activeId)
      const to = queue.findIndex((q) => q.uid === overId)
      if (from >= 0 && to >= 0) reorderQueue(from, to)
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      <div className="app">
        <TopBar />
        <div className="main">
          <UpdateBanner />
          <DesktopPrompt />
          <AlertBanner />
          <div className="browser">
            <PlaylistsPane />
            <LibraryPane />
            <QueuePane />
          </div>
        </div>
        <TransportBar />
      </div>
      <SettingsModal />
      <SavePlaylistModal />
      <SaveSceneModal />
      <SongEditModal />
      <ImportWizardModal />
      <DisclaimerModal />
      <Toast />
    </DndContext>
  )
}
