import type { BioGymRunEvent } from '@shared/biogym'
import type { SciForgeApi } from '@shared/sciforge-api'

export function subscribeBioGymRunEvents(
  api: SciForgeApi | undefined,
  handler: (event: BioGymRunEvent) => void,
  onReplayError?: (error: unknown) => void
): () => void {
  const biogym = api?.biogym
  if (typeof biogym?.onRunEvent !== 'function') return () => undefined
  const unsubscribe = biogym.onRunEvent(handler)
  if (typeof biogym.replay === 'function') {
    try {
      void biogym.replay().catch((error) => onReplayError?.(error))
    } catch (error) {
      onReplayError?.(error)
    }
  }
  return unsubscribe
}
