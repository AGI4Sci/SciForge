import { createContext, useContext } from 'react'

/** Presentation context follows the existing page when it is moved between windows. */
export const WorkspaceDocumentContext = createContext<Document | undefined>(undefined)
export const useWorkspaceDocument = (): Document => useContext(WorkspaceDocumentContext) ?? globalThis.document
