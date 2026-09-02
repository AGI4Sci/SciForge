import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
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
  return Object.freeze({
    view: (input) => invoker.invoke(evidenceDagCapabilityContracts.view, input),
    update: (input) => invoker.invoke(evidenceDagCapabilityContracts.update, input),
    priority: (input) => invoker.invoke(evidenceDagCapabilityContracts.priority, input),
    sealClosure: (input) => invoker.invoke(evidenceDagCapabilityContracts.sealClosure, input),
    snapshotStatus: (input) => invoker.invoke(evidenceDagCapabilityContracts.snapshotStatus, input),
    resolvePreview: (input) =>
      invoker.invoke(evidenceDagCapabilityContracts.resolvePreview, input)
  })
}
