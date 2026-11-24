import { createContext } from 'react'

/** Owning view identity; prevents a secondary timeline from borrowing active-session facts. */
export const CodeSelectionScope = createContext<{ sessionId?: string; workspaceRoot?: string }>({})
