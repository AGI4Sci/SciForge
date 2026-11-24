import {
  DOCUMENT_SHARES_ROUTE, DOCUMENT_COMMENTS_READ_ROUTE, DOCUMENT_COMMENTS_MUTATE_ROUTE,
  documentShareLookupRequestSchema, documentShareCreateRequestSchema, documentShareRevokeRequestSchema,
  documentShareManageResponseSchema, documentCommentReadRequestSchema, documentCommentMutateRequestSchema,
  documentCommentResponseSchema, documentCommentMutateResponseSchema,
  type DocumentShareLookupRequest, type DocumentShareCreateRequest, type DocumentShareRevokeRequest,
  type DocumentCommentReadRequest, type DocumentCommentMutateRequest, type DocumentShareManageResponse, type DocumentSource
} from '@sciforge/document-sharing-contracts'
import type { WithCloudTransportLease } from './cloud-authority.js'
import { requestCloudJson } from './cloud-json-request.js'

// Only these closed protocol reasons cross the transport boundary. Server message,
// HTML, unknown codes and mismatched status/code pairs are never reflected.
const sharingRejections = ([
  [400, 'unsupported_content'], [400, 'invalid_request'], [400, 'source_mismatch'],
  [401, 'login_required'], [403, 'access_denied'], [403, 'permission_denied'], [403, 'link_revoked'],
  [404, 'document_not_found'], [404, 'link_not_found'],
  [409, 'revision_conflict'], [409, 'idempotency_conflict'], [409, 'operation_in_doubt'],
  [409, 'operation_rejected'], [502, 'kernel_response_invalid'],
  [503, 'kernel_unavailable'], [503, 'service_unavailable']
] as const).map(([status, code]) => ({ status, code, message: `Cloud rejection: ${code}.` }))

function matchesSource(result: DocumentShareManageResponse, source: DocumentSource): boolean {
  if (!result.share) return result.shareUrl === null
  return result.share.source.spaceId === source.spaceId && result.share.source.documentId === source.documentId &&
    result.shareUrl !== null && new URL(result.shareUrl).pathname === `/share/${result.share.shareId}`
}
export function lookupDocumentShare(input: DocumentShareLookupRequest, lease: WithCloudTransportLease, options?: Readonly<{ signal?: AbortSignal }>) {
  const request = documentShareLookupRequestSchema.parse(input)
  return requestCloudJson(lease, { path: `${DOCUMENT_SHARES_ROUTE}/lookup`, body: request,
    schema: documentShareManageResponseSchema, maximumBytes: 16_384, rejections: sharingRejections,
    validate: result => matchesSource(result, request.source) }, options)
}
export function createDocumentShare(input: DocumentShareCreateRequest, lease: WithCloudTransportLease, options?: Readonly<{ signal?: AbortSignal }>) {
  const request = documentShareCreateRequestSchema.parse(input)
  return requestCloudJson(lease, { path: DOCUMENT_SHARES_ROUTE, body: request,
    schema: documentShareManageResponseSchema, maximumBytes: 16_384, rejections: sharingRejections,
    validate: result => matchesSource(result, request.source) && result.share?.status === 'active' && result.share.permission === request.permission }, options)
}
export function revokeDocumentShare(input: DocumentShareRevokeRequest, lease: WithCloudTransportLease, options?: Readonly<{ signal?: AbortSignal }>) {
  const request = documentShareRevokeRequestSchema.parse(input)
  return requestCloudJson(lease, { path: `${DOCUMENT_SHARES_ROUTE}/revoke`, body: request,
    schema: documentShareManageResponseSchema, maximumBytes: 16_384, rejections: sharingRejections,
    validate: result => matchesSource(result, request.source) && result.share?.shareId === request.shareId && result.share.status === 'revoked' }, options)
}
export function readDocumentComments(input: DocumentCommentReadRequest, lease: WithCloudTransportLease, options?: Readonly<{ signal?: AbortSignal }>) {
  const request = documentCommentReadRequestSchema.parse(input)
  return requestCloudJson(lease, { path: DOCUMENT_COMMENTS_READ_ROUTE, body: request,
    schema: documentCommentResponseSchema, maximumBytes: 8_388_608, rejections: sharingRejections, validate: () => true }, options)
}
export function mutateDocumentComments(input: DocumentCommentMutateRequest, lease: WithCloudTransportLease, options?: Readonly<{ signal?: AbortSignal }>) {
  const request = documentCommentMutateRequestSchema.parse(input)
  return requestCloudJson(lease, { path: DOCUMENT_COMMENTS_MUTATE_ROUTE, body: request,
    schema: documentCommentMutateResponseSchema, maximumBytes: 8_388_608, rejections: sharingRejections, validate: () => true }, options)
}
