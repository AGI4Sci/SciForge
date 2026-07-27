import { createContext, useContext, type ReactElement, type ReactNode } from 'react'

const RightPanelSessionContext = createContext<string | null>(null)

export function RightPanelSessionScope({
  sessionId,
  children
}: {
  sessionId: string
  children: ReactNode
}): ReactElement {
  return (
    <RightPanelSessionContext.Provider value={sessionId}>
      {children}
    </RightPanelSessionContext.Provider>
  )
}

export function useRightPanelSessionId(): string | null {
  return useContext(RightPanelSessionContext)
}
