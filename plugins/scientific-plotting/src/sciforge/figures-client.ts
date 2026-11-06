import type { FiguresClient } from '../ui/FiguresPanel.js'
import type { CodeRunsTransport } from '../ui/CodeRunsPanel.js'

/** Shared panel adapter; each host supplies its own authorized operation transport. */
export function createFiguresClient(invoke: CodeRunsTransport): FiguresClient & { call: CodeRunsTransport } {
  return {
    call: invoke,
    list: () => invoke('list', {}),
    read: documentId => invoke('read', { documentId }),
    image: (documentId, revisionId) => invoke('image', { documentId, revisionId }),
    importOriginal: (path, input) => invoke('importOriginal', { ...input, path }),
    addCandidate: (path, input) => invoke('addCandidate', { ...input, path }),
    acceptCandidate: input => invoke('acceptCandidate', input),
    rejectCandidate: input => invoke('rejectCandidate', input),
    render: input => invoke('render', input)
  }
}
