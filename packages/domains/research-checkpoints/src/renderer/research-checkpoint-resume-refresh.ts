type ResumeEventListener = () => void

export type ResearchCheckpointResumeDocument = Readonly<{
  visibilityState?: string
  addEventListener(type: 'visibilitychange', listener: ResumeEventListener): void
  removeEventListener(type: 'visibilitychange', listener: ResumeEventListener): void
}>

export type ResearchCheckpointResumeWindow = Readonly<{
  addEventListener(type: 'focus', listener: ResumeEventListener): void
  removeEventListener(type: 'focus', listener: ResumeEventListener): void
}>

/**
 * Refreshes an already-confirmed, active-recording probe when the user returns
 * to the app. The caller decides eligibility so ordinary unrecorded history
 * never acquires global listeners or background polling.
 */
export function installResearchCheckpointResumeRefresh(
  onRefresh: () => void,
  targets: Readonly<{
    documentTarget?: ResearchCheckpointResumeDocument
    windowTarget?: ResearchCheckpointResumeWindow
  }> = {}
): () => void {
  const documentTarget = targets.documentTarget ?? browserDocument()
  const windowTarget = targets.windowTarget ?? browserWindow()
  let active = true
  let queued = false
  const refreshWhenVisible = () => {
    if (!active || documentTarget?.visibilityState === 'hidden' || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (active) onRefresh()
    })
  }

  documentTarget?.addEventListener('visibilitychange', refreshWhenVisible)
  windowTarget?.addEventListener('focus', refreshWhenVisible)
  return () => {
    active = false
    documentTarget?.removeEventListener('visibilitychange', refreshWhenVisible)
    windowTarget?.removeEventListener('focus', refreshWhenVisible)
  }
}

function browserDocument(): ResearchCheckpointResumeDocument | undefined {
  return typeof document === 'undefined' ? undefined : document
}

function browserWindow(): ResearchCheckpointResumeWindow | undefined {
  return typeof window === 'undefined' ? undefined : window
}
