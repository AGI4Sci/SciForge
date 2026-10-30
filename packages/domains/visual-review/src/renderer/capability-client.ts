import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import {
  VISUAL_REVIEW_CAPABILITY_IDS,
  visualReviewApplyStyleReferenceInputSchema,
  visualReviewApplyStyleReferenceOutputSchema,
  visualReviewCreateCandidateInputSchema,
  visualReviewCreateCandidateOutputSchema,
  visualReviewDocumentInputSchema,
  visualReviewExportReviewPacketOutputSchema,
  visualReviewOpenInputSchema,
  visualReviewOpenOutputSchema,
  visualReviewReadImageInputSchema,
  visualReviewReadImageOutputSchema,
  visualReviewRevisionDecisionInputSchema,
  visualReviewRevisionDecisionOutputSchema,
  visualReviewSaveAnnotationsInputSchema,
  visualReviewSaveAnnotationsOutputSchema,
  visualReviewUpdateContextInputSchema,
  visualReviewUpdateContextOutputSchema,
  type VisualReviewCreateCandidateInput,
  type VisualReviewApplyStyleReferenceInput,
  type VisualReviewDocumentInput,
  type VisualReviewOpenInput,
  type VisualReviewRevisionDecisionInput,
  type VisualReviewSaveAnnotationsInput,
  type VisualReviewUpdateContextInput
} from '../contract.js'
import type {
  VisualDocumentApplyStyleReferenceResult,
  VisualDocumentCreateCandidateResult,
  VisualDocumentExportReviewPacketResult,
  VisualDocumentOpenResult,
  VisualDocumentRevisionDecisionResult,
  VisualDocumentSaveAnnotationsResult,
  VisualDocumentUpdateContextResult
} from '../types.js'

const contracts = Object.freeze({
  open: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.open,
    effect: 'workspace-write' as const,
    inputSchema: visualReviewOpenInputSchema,
    outputSchema: visualReviewOpenOutputSchema
  },
  readDocument: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.readDocument,
    effect: 'read' as const,
    inputSchema: visualReviewDocumentInputSchema,
    outputSchema: visualReviewOpenOutputSchema
  },
  readImage: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.readImage,
    effect: 'read' as const,
    inputSchema: visualReviewReadImageInputSchema,
    outputSchema: visualReviewReadImageOutputSchema
  },
  updateContext: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.updateContext,
    effect: 'workspace-write' as const,
    inputSchema: visualReviewUpdateContextInputSchema,
    outputSchema: visualReviewUpdateContextOutputSchema
  },
  applyStyleReference: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference,
    effect: 'workspace-write' as const,
    inputSchema: visualReviewApplyStyleReferenceInputSchema,
    outputSchema: visualReviewApplyStyleReferenceOutputSchema
  },
  saveAnnotations: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations,
    effect: 'workspace-write' as const,
    inputSchema: visualReviewSaveAnnotationsInputSchema,
    outputSchema: visualReviewSaveAnnotationsOutputSchema
  },
  exportReviewPacket: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket,
    effect: 'workspace-write' as const,
    inputSchema: visualReviewDocumentInputSchema,
    outputSchema: visualReviewExportReviewPacketOutputSchema
  },
  createCandidate: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.createCandidate,
    effect: 'workspace-write' as const,
    inputSchema: visualReviewCreateCandidateInputSchema,
    outputSchema: visualReviewCreateCandidateOutputSchema
  },
  acceptCandidate: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate,
    effect: 'destructive' as const,
    inputSchema: visualReviewRevisionDecisionInputSchema,
    outputSchema: visualReviewRevisionDecisionOutputSchema
  },
  rejectCandidate: {
    actionId: VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate,
    effect: 'workspace-write' as const,
    inputSchema: visualReviewRevisionDecisionInputSchema,
    outputSchema: visualReviewRevisionDecisionOutputSchema
  }
})

export type VisualReviewCapabilityClient = Readonly<{
  open(input: VisualReviewOpenInput, workspaceRoot: string): Promise<VisualDocumentOpenResult>
  readDocument(input: VisualReviewDocumentInput, workspaceRoot: string):
    Promise<VisualDocumentOpenResult>
  readImage(path: string, workspaceRoot: string): Promise<{ ok: true; dataUrl: string }>
  updateContext(input: VisualReviewUpdateContextInput, workspaceRoot: string):
    Promise<VisualDocumentUpdateContextResult>
  applyStyleReference(input: VisualReviewApplyStyleReferenceInput, workspaceRoot: string):
    Promise<VisualDocumentApplyStyleReferenceResult>
  saveAnnotations(input: VisualReviewSaveAnnotationsInput, workspaceRoot: string):
    Promise<VisualDocumentSaveAnnotationsResult>
  exportReviewPacket(input: VisualReviewDocumentInput, workspaceRoot: string):
    Promise<VisualDocumentExportReviewPacketResult>
  createCandidate(input: VisualReviewCreateCandidateInput, workspaceRoot: string):
    Promise<VisualDocumentCreateCandidateResult>
  acceptCandidate(input: VisualReviewRevisionDecisionInput, workspaceRoot: string):
    Promise<VisualDocumentRevisionDecisionResult>
  rejectCandidate(input: VisualReviewRevisionDecisionInput, workspaceRoot: string):
    Promise<VisualDocumentRevisionDecisionResult>
}>

export function createVisualReviewCapabilityClient(
  invoker: DomainRendererCapabilityInvoker
): VisualReviewCapabilityClient {
  return Object.freeze({
    open: (input, workspaceRoot) =>
      invoker.invoke(contracts.open, input, { workspaceId: workspaceRoot }),
    readDocument: (input, workspaceRoot) =>
      invoker.invoke(contracts.readDocument, input, { workspaceId: workspaceRoot }),
    readImage: (path, workspaceRoot) =>
      invoker.invoke(contracts.readImage, { path }, { workspaceId: workspaceRoot }),
    updateContext: (input, workspaceRoot) =>
      invoker.invoke(contracts.updateContext, input, { workspaceId: workspaceRoot }),
    applyStyleReference: (input, workspaceRoot) =>
      invoker.invoke(contracts.applyStyleReference, input, { workspaceId: workspaceRoot }),
    saveAnnotations: (input, workspaceRoot) =>
      invoker.invoke(contracts.saveAnnotations, input, { workspaceId: workspaceRoot }),
    exportReviewPacket: (input, workspaceRoot) =>
      invoker.invoke(contracts.exportReviewPacket, input, { workspaceId: workspaceRoot }),
    createCandidate: (input, workspaceRoot) =>
      invoker.invoke(contracts.createCandidate, input, { workspaceId: workspaceRoot }),
    acceptCandidate: (input, workspaceRoot) =>
      invoker.invoke(contracts.acceptCandidate, input, {
        workspaceId: workspaceRoot,
        approval: { mode: 'confirmation' }
      }),
    rejectCandidate: (input, workspaceRoot) =>
      invoker.invoke(contracts.rejectCandidate, input, { workspaceId: workspaceRoot })
  })
}
