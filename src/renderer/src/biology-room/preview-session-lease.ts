export type BiologyPreviewSessionLease = {
  track: (sessionId: string) => void
  releaseAll: () => void
}

export function createBiologyPreviewSessionLease(
  releaseSession: (sessionId: string) => Promise<unknown>
): BiologyPreviewSessionLease {
  const sessionIds = new Set<string>()
  let released = false

  const release = (sessionId: string): void => {
    void Promise.resolve()
      .then(() => releaseSession(sessionId))
      .catch(() => undefined)
  }

  return {
    track(sessionId) {
      if (released) {
        release(sessionId)
        return
      }
      sessionIds.add(sessionId)
    },
    releaseAll() {
      if (released) return
      released = true
      for (const sessionId of sessionIds) release(sessionId)
      sessionIds.clear()
    }
  }
}
