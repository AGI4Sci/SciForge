import { z } from 'zod'
import {
  documentShareCreateRequestSchema, documentShareManageResponseSchema, documentShareRevokeRequestSchema
} from '@sciforge/document-sharing-contracts'

/** The resource, not renderer input, determines the shared document and space. */
export const siyuanDocumentShareLookupContract = Object.freeze({
  actionId: 'siyuan.document.share.lookup', effect: 'read' as const,
  inputSchema: z.object({}).strict(), outputSchema: documentShareManageResponseSchema
})
export const siyuanDocumentShareCreateContract = Object.freeze({
  actionId: 'siyuan.document.share.create', effect: 'external-write' as const,
  inputSchema: documentShareCreateRequestSchema.omit({ source: true, idempotencyKey: true }),
  outputSchema: documentShareManageResponseSchema
})
export const siyuanDocumentShareRevokeContract = Object.freeze({
  actionId: 'siyuan.document.share.revoke', effect: 'external-write' as const,
  inputSchema: documentShareRevokeRequestSchema.omit({ source: true, idempotencyKey: true }),
  outputSchema: documentShareManageResponseSchema
})
