import {
  acceptVisualCandidateRevision,
  abortPreparedVisualCandidateAcceptance,
  applyVisualStyleReference,
  createVisualCandidateRevision,
  exportVisualReviewPacket,
  openVisualReviewDocument,
  preflightVisualCandidateAcceptance,
  readVisualReviewImage,
  rejectVisualCandidateRevision,
  saveVisualDocumentAnnotations,
  updateVisualDocumentContext
} from './main/service.js'
import type { VisualReviewServicePort } from './capability-factory.js'

export * from './capability-factory.js'
export * from './main/service.js'

/** Package-owned service composition; no static host entry or secondary runtime. */
export function createVisualReviewService(): VisualReviewServicePort {
  return Object.freeze({
    open: openVisualReviewDocument,
    readImage: readVisualReviewImage,
    updateContext: updateVisualDocumentContext,
    applyStyleReference: applyVisualStyleReference,
    saveAnnotations: saveVisualDocumentAnnotations,
    exportReviewPacket: exportVisualReviewPacket,
    createCandidate: createVisualCandidateRevision,
    preflightAcceptCandidate: preflightVisualCandidateAcceptance,
    abortPreparedAcceptance: abortPreparedVisualCandidateAcceptance,
    acceptCandidate: acceptVisualCandidateRevision,
    rejectCandidate: rejectVisualCandidateRevision
  })
}
