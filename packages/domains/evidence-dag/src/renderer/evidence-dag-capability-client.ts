import { evidenceDagRerunSpecInputSchema, evidenceDagRerunSpecOutputSchema, evidenceDagRerunCompareInputSchema, evidenceDagRerunCompareOutputSchema, type EvidenceDagRerunSpecInput, type EvidenceDagRerunCompareInput } from '../contract'
import type { DomainRendererCapabilityInvoker, DomainRendererCapabilityContract } from '@sciforge/domain-sdk/host'
import {
  EVIDENCE_DAG_CAPABILITY_IDS,
  evidenceDagPreviewInputSchema,
  evidenceDagPreviewOutputSchema,
  evidenceDagPriorityInputSchema,
  evidenceDagPriorityOutputSchema,
  evidenceDagSealClosureInputSchema,
  evidenceDagSealClosureOutputSchema,
  evidenceDagSnapshotStatusInputSchema,
  evidenceDagSnapshotStatusOutputSchema,
  evidenceDagUpdateInputSchema,
  evidenceDagUpdateOutputSchema,
  evidenceDagViewInputSchema,
  evidenceDagViewOutputSchema,
  type EvidenceDagPreviewInput,
  type EvidenceDagPreviewOutput,
  type EvidenceDagPriorityInput,
  type EvidenceDagPriorityOutput,
  type EvidenceDagSealClosureInput,
  type EvidenceDagSealClosureOutput,
  type EvidenceDagSnapshotStatusInput,
  type EvidenceDagCanonicalStatus,
  type EvidenceDagUpdateInput,
  type EvidenceDagUpdateOutput,
  type EvidenceDagViewInput,
  type EvidenceDagViewOutput
} from '../contract'

export const evidenceDagCapabilityContracts = Object.freeze({
  rerunSpec: { actionId: EVIDENCE_DAG_CAPABILITY_IDS.rerunSpec, effect: 'read' as const, inputSchema: evidenceDagRerunSpecInputSchema, outputSchema: evidenceDagRerunSpecOutputSchema },
  rerunCompare: { actionId: EVIDENCE_DAG_CAPABILITY_IDS.rerunCompare, effect: 'read' as const, inputSchema: evidenceDagRerunCompareInputSchema, outputSchema: evidenceDagRerunCompareOutputSchema },
  view: {
    actionId: EVIDENCE_DAG_CAPABILITY_IDS.view,
    effect: 'read' as const,
    inputSchema: evidenceDagViewInputSchema,
    outputSchema: evidenceDagViewOutputSchema
  },
  update: {
    actionId: EVIDENCE_DAG_CAPABILITY_IDS.update,
    effect: 'compute' as const,
    inputSchema: evidenceDagUpdateInputSchema,
    outputSchema: evidenceDagUpdateOutputSchema
  },
  priority: {
    actionId: EVIDENCE_DAG_CAPABILITY_IDS.priority,
    effect: 'compute' as const,
    inputSchema: evidenceDagPriorityInputSchema,
    outputSchema: evidenceDagPriorityOutputSchema
  },
  sealClosure: {
    actionId: EVIDENCE_DAG_CAPABILITY_IDS.sealClosure,
    effect: 'compute' as const,
    inputSchema: evidenceDagSealClosureInputSchema,
    outputSchema: evidenceDagSealClosureOutputSchema
  },
  snapshotStatus: {
    actionId: EVIDENCE_DAG_CAPABILITY_IDS.snapshotStatus,
    effect: 'read' as const,
    inputSchema: evidenceDagSnapshotStatusInputSchema,
    outputSchema: evidenceDagSnapshotStatusOutputSchema
  },
  resolvePreview: {
    actionId: EVIDENCE_DAG_CAPABILITY_IDS.resolvePreview,
    effect: 'read' as const,
    inputSchema: evidenceDagPreviewInputSchema,
    outputSchema: evidenceDagPreviewOutputSchema
  }
})

export type EvidenceDagCapabilityClient = Readonly<{
  rerunSpec: (input: EvidenceDagRerunSpecInput) => Promise<import('@sciforge/domain-sdk/reproducibility').SciForgeReproSpecV1>
  rerunCompare: (input: EvidenceDagRerunCompareInput) => Promise<import('../contract').EvidenceDagRerunCompareOutput>
  view: (input: EvidenceDagViewInput) => Promise<EvidenceDagViewOutput>
  update: (input: EvidenceDagUpdateInput) => Promise<EvidenceDagUpdateOutput>
  priority: (input: EvidenceDagPriorityInput) => Promise<EvidenceDagPriorityOutput>
  sealClosure: (input: EvidenceDagSealClosureInput) => Promise<EvidenceDagSealClosureOutput>
  snapshotStatus: (input: EvidenceDagSnapshotStatusInput) => Promise<EvidenceDagCanonicalStatus>
  resolvePreview: (input: EvidenceDagPreviewInput) => Promise<EvidenceDagPreviewOutput>
}>

export function createEvidenceDagCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): EvidenceDagCapabilityClient {
  const invoke = async <TInput extends { workspaceRoot?: string }, TOutput>(
    contract: DomainRendererCapabilityContract<TInput, TOutput>, input: TInput
  ): Promise<TOutput> => {
    const workspaceId = input.workspaceRoot?.trim()
    if (!workspaceId) throw new Error('Evidence DAG requires an explicit caller workspace scope.')
    return invoker.invoke(contract, input, { workspaceId })
  }
  return Object.freeze({
    rerunSpec: (input) => invoke(evidenceDagCapabilityContracts.rerunSpec, input),
    rerunCompare: (input) => invoke(evidenceDagCapabilityContracts.rerunCompare, input),
    view: (input) => invoke(evidenceDagCapabilityContracts.view, input),
    update: (input) => invoke(evidenceDagCapabilityContracts.update, input),
    priority: (input) => invoke(evidenceDagCapabilityContracts.priority, input),
    sealClosure: (input) => invoke(evidenceDagCapabilityContracts.sealClosure, input),
    snapshotStatus: (input) => invoke(evidenceDagCapabilityContracts.snapshotStatus, input),
    resolvePreview: (input) =>
      invoke(evidenceDagCapabilityContracts.resolvePreview, input)
  })
}
