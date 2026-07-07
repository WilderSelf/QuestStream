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
import { Splitter } from './components/Splitter'
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
  const browserSplit = useStore((s) => s.browserSplit)
  const setBrowserSplit = useStore((s) => s.setBrowserSplit)
  const railWidth = useStore((s) => s.railWidth)
  const setRailWidth = useStore((s) => s.setRailWidth)
  const playlistsCollapsed = useStore((s) => s.playlistsCollapsed)

  useEffect(() => {
    void init()
  }, [init])

  // Re-apply the persisted display prefs once on launch: webFrame zoom is per-session, the
  // text-scale CSS var must be seeded onto :root, and the saved theme must be applied (which also
  // re-reads the --tag-* swatch palette so tags paint in the active theme).
  useEffect(() => {
    const { uiScale, textScale, theme, setTheme } = useStore.getState()
    window.api.app.setZoomFactor(uiScale)
    document.documentElement.style.setProperty('--text-scale', String(textScale))
    setTheme(theme)
  }, [])

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
      // ...onto the ambience area → its own new layer (each sound is one layer)
      if (overId === 'ambience-drop') {
        addAmbience(song)
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
          <div
            className="browser"
            style={{
              // The rail's 6px handle track only exists while the rail is expanded.
              gridTemplateColumns: playlistsCollapsed
                ? `auto ${browserSplit}fr 6px ${1 - browserSplit}fr`
                : `auto 6px ${browserSplit}fr 6px ${1 - browserSplit}fr`
            }}
          >
            <PlaylistsPane />
            {!playlistsCollapsed && (
              <Splitter
                orientation="vertical"
                mode="pixel"
                value={railWidth}
                onChange={setRailWidth}
                onReset={() => setRailWidth(200)}
                ariaLabel="Resize the scenes and playlists rail"
              />
            )}
            <LibraryPane />
            <Splitter
              orientation="vertical"
              value={browserSplit}
              onChange={setBrowserSplit}
              onReset={() => setBrowserSplit(1.7 / (1.7 + 1.2))}
              ariaLabel="Resize library and mix columns"
            />
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
