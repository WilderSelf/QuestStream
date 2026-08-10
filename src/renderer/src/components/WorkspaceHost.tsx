import { useStore } from '../store'
import { LibraryPane } from './LibraryPane'

/**
 * The center region of the grimoire shell. Renders whichever workspace is open;
 * the union grows as workspaces land (builder/scene in Phase 4–5, import in 6,
 * triage in 7). 'library' is the default and, for now, the only workspace.
 */
export function WorkspaceHost(): JSX.Element {
  const workspace = useStore((s) => s.workspace)
  switch (workspace) {
    case 'library':
    default:
      return <LibraryPane />
  }
}
