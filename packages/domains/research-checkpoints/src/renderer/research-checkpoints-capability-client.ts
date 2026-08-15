import {
  ARTIFACT_VERSION_READ_CONTRACT,
  type ArtifactVersionReadInputV1,
  type ArtifactVersionReadResultV1
} from '@sciforge/domain-artifact-versions/contract'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'

import {
  RESEARCH_CHECKPOINT_CAPABILITY_IDS,
  researchCheckpointResolveInputV1Schema,
  researchCheckpointResolveResultV1Schema,
  researchCheckpointStartInputV1Schema,
  researchCheckpointStartResultV1Schema,
  researchCheckpointStatusInputV1Schema,
  researchCheckpointStatusResultV1Schema,
  researchCheckpointStopInputV1Schema,
  researchCheckpointStopResultV1Schema,
  researchCheckpointTurnStatusInputV1Schema,
  researchCheckpointTurnStatusResultV1Schema,
  type ResearchCheckpointResultV1,
  type ResearchCheckpointResolveInputV1,
  type ResearchCheckpointResolveReceiptV1,
  type ResearchCheckpointStartInputV1,
  type ResearchCheckpointStartReceiptV1,
  type ResearchCheckpointStatusInputV1,
  type ResearchCheckpointStatusV1,
  type ResearchCheckpointStopInputV1,
  type ResearchCheckpointStopReceiptV1,
  type ResearchCheckpointTurnStatusInputV1,
  type ResearchCheckpointTurnStatusV1
} from '../contract.js'

const turnStatusContract = Object.freeze({
  actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.turnStatus,
  effect: 'read' as const,
  inputSchema: researchCheckpointTurnStatusInputV1Schema,
  outputSchema: researchCheckpointTurnStatusResultV1Schema
})

const statusContract = Object.freeze({
  actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.status,
  effect: 'read' as const,
  inputSchema: researchCheckpointStatusInputV1Schema,
  outputSchema: researchCheckpointStatusResultV1Schema
})

const resolveContract = Object.freeze({
  actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.resolve,
  effect: 'workspace-write' as const,
  inputSchema: researchCheckpointResolveInputV1Schema,
  outputSchema: researchCheckpointResolveResultV1Schema
})

const startContract = Object.freeze({
  actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.start,
  effect: 'workspace-write' as const,
  inputSchema: researchCheckpointStartInputV1Schema,
  outputSchema: researchCheckpointStartResultV1Schema
})

const stopContract = Object.freeze({
  actionId: RESEARCH_CHECKPOINT_CAPABILITY_IDS.stop,
  effect: 'workspace-write' as const,
  inputSchema: researchCheckpointStopInputV1Schema,
  outputSchema: researchCheckpointStopResultV1Schema
})

export type ResearchCheckpointsRendererClient = Readonly<{
  readExactOutput(
    workspaceRoot: string,
    input: ArtifactVersionReadInputV1
  ): Promise<ArtifactVersionReadResultV1>
  startRecording(
    workspaceRoot: string,
    input: ResearchCheckpointStartInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointStartReceiptV1>>
  stopRecording(
    workspaceRoot: string,
    input: ResearchCheckpointStopInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointStopReceiptV1>>
  readStatus(
    workspaceRoot: string,
    input: ResearchCheckpointStatusInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointStatusV1>>
  readTurnStatus(
    workspaceRoot: string,
    input: ResearchCheckpointTurnStatusInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointTurnStatusV1>>
  resolveStaleConflict(
    workspaceRoot: string,
    input: ResearchCheckpointResolveInputV1
  ): Promise<ResearchCheckpointResultV1<ResearchCheckpointResolveReceiptV1>>
}>

export function createResearchCheckpointsRendererClient(
  invoker: DomainRendererCapabilityInvoker
): ResearchCheckpointsRendererClient {
  return Object.freeze({
    readExactOutput: (workspaceRoot, input) => invoker.invoke(
      ARTIFACT_VERSION_READ_CONTRACT,
      input,
      { workspaceId: workspaceRoot }
    ),
    startRecording: (workspaceRoot, input) => invoker.invoke(
      startContract,
      input,
      { workspaceId: workspaceRoot }
    ),
    stopRecording: (workspaceRoot, input) => invoker.invoke(
      stopContract,
      input,
      { workspaceId: workspaceRoot }
    ),
    readStatus: (workspaceRoot, input) => invoker.invoke(
      statusContract,
      input,
      { workspaceId: workspaceRoot }
    ),
    readTurnStatus: (workspaceRoot, input) => invoker.invoke(
      turnStatusContract,
      input,
      { workspaceId: workspaceRoot }
    ),
    resolveStaleConflict: (workspaceRoot, input) => invoker.invoke(
      resolveContract,
      input,
      {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }
    )
  })
}

export const researchCheckpointsRendererContracts = Object.freeze({
  start: startContract,
  stop: stopContract,
  status: statusContract,
  turnStatus: turnStatusContract,
  resolve: resolveContract
})
