import { useStore } from '../store'
import { LibraryPane } from './LibraryPane'
import { SceneBuilder } from './SceneBuilder'
import { ScenePage } from './ScenePage'
import { ImportWorkbench } from './ImportWorkbench'

/**
 * The center region of the grimoire shell. Renders whichever workspace is open;
 * the union grows as workspaces land (scene page in Phase 5, import in 6,
 * triage in 7). 'library' is the default.
 */
export function WorkspaceHost(): JSX.Element {
  const workspace = useStore((s) => s.workspace)
  const builderKey = useStore((s) => s.builderKey)
  const scenePageId = useStore((s) => s.scenePageId)
  switch (workspace) {
    case 'builder':
      // A builder with no draft (e.g. discarded elsewhere) falls back to the library.
      if (builderKey) return <SceneBuilder />
      return <LibraryPane />
    case 'scene':
      // A page whose scene was deleted falls back to the library.
      if (scenePageId) return <ScenePage />
      return <LibraryPane />
    case 'import':
      return <ImportWorkbench />
    case 'library':
    default:
      return <LibraryPane />
  }
}
