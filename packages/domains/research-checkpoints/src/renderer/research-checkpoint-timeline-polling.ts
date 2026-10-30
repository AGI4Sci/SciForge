import type { ResearchCheckpointTurnStatusV1 } from '../contract.js'

const MAX_AUTOMATIC_PENDING_POLLS = 8
const MAX_AUTOMATIC_UNRECORDED_POLLS = 16

export type ResearchCheckpointTurnLifecycleHint = Readonly<{
  phase: 'active' | 'terminal' | 'settled'
  revision: string
  isLatest: boolean
  status?: string
}>

export function shouldProbeUnrecordedCheckpoint(
  status: ResearchCheckpointTurnStatusV1,
  lifecycle: ResearchCheckpointTurnLifecycleHint | undefined,
  recordingActive: boolean
): boolean {
  return status.state === 'unrecorded' &&
    recordingActive &&
    lifecycle?.isLatest === true &&
    lifecycle.phase === 'terminal'
}

export function automaticUnrecordedPollDelay(completedPolls: number): number | undefined {
  if (completedPolls >= MAX_AUTOMATIC_UNRECORDED_POLLS) return undefined
  if (completedPolls < 4) return 250 + completedPolls * 250
  return Math.min(1_500 + (completedPolls - 4) * 750, 5_000)
}

export function automaticPendingPollDelay(
  status: ResearchCheckpointTurnStatusV1,
  completedPolls: number
): number | undefined {
  const awaitingCommit = status.state === 'pending'
  const awaitingEvidence = status.state === 'committed' && status.evidence.status === 'pending'
  if (!(awaitingCommit || awaitingEvidence) || completedPolls >= MAX_AUTOMATIC_PENDING_POLLS) {
    return undefined
  }
  return Math.min(1_000 + (completedPolls + 1) * 250, 3_000)
}
