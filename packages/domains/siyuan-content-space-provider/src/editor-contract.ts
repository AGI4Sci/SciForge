import { z } from 'zod'
import { domainCapabilityResourceHandleSchema } from '@sciforge/domain-sdk/host'
import { cloudSpaceIdSchema, cloudSpaceEnsureRequestSchema, cloudSpaceResponseSchema, cloudSpacesListResponseSchema } from '@sciforge/cloud-spaces-contracts'
import { currentUserProfileSchema } from '@sciforge/domain-identity-access/current-user-profile'

/** Server mode only: SciForge connects to a SiYuan service and never starts or
 * ships one. The address is optional so the main process can fall back to the
 * service configured for the installation (`SIYUAN_BASE_URL`). */
export const siyuanEditorRequestSchema = z.object({ refresh: z.boolean().optional().describe('Request a fresh sign-in only for explicit Refresh/Retry; normal opens reuse a valid authorized session.'), spaceId: cloudSpaceIdSchema.optional().describe('Required for managed cloud services. List spaces and choose the personal or project space explicitly; omit only for an explicitly configured custom service.') }).strict()
export const siyuanEditorResultSchema = z.object({ url: z.string().url(), spaceId: cloudSpaceIdSchema.optional().describe('Required for managed cloud services. List spaces and choose the personal or project space explicitly; omit only for an explicitly configured custom service.'), expiresAt: z.iso.datetime().optional() }).strict()
export const siyuanEditorContract = Object.freeze({
  actionId: 'siyuan.editor.open',
  effect: 'compute' as const,
  inputSchema: siyuanEditorRequestSchema,
  outputSchema: siyuanEditorResultSchema
})

/** Device-independent slot rectangle measured by the Host renderer. */
export const siyuanEditorViewportSchema = z.object({
  x: z.number().int().min(0).max(32_768),
  y: z.number().int().min(0).max(32_768),
  width: z.number().int().min(0).max(8_192),
  height: z.number().int().min(0).max(8_192),
  visible: z.boolean(),
  windowName: z.string().regex(/^sciforge-workbench:[a-zA-Z0-9_.:-]{1,180}$/u).optional()
}).strict()
export type SiYuanEditorViewport = z.infer<typeof siyuanEditorViewportSchema>

/** `url: null` detaches the native editor, so an idle page never keeps a hidden
 * child view attached behind the Host renderer. */
export const siyuanEditorPresentRequestSchema = z.object({
  sessionId: z.string().min(1).max(1024).optional(),
  reloadRevision: z.number().int().nonnegative().optional(),
  url: z.string().url().nullable(),
  viewport: siyuanEditorViewportSchema
}).strict()
export const siyuanEditorPresentResultSchema = z.object({ presented: z.boolean() }).strict()
export const siyuanEditorPresentContract = Object.freeze({
  actionId: 'siyuan.editor.present',
  effect: 'compute' as const,
  inputSchema: siyuanEditorPresentRequestSchema,
  outputSchema: siyuanEditorPresentResultSchema
})

/** Where the effective address and token come from. Without this a person
 * cannot tell whether the value they typed is the one being used, or whether an
 * installation-wide default is silently in charge. */
export const siyuanServiceStatusSchema = z.object({
  editorAvailable: z.boolean().optional(),
  mode: z.enum(['managed', 'custom']),
  url: z.string().max(2_048).nullable(),
  urlSource: z.enum(['configured', 'environment', 'none']),
  token: z.enum(['stored', 'environment', 'none']),
  tokenStorage: z.enum(['available', 'unavailable']),
  identity: currentUserProfileSchema
}).strict()
export type SiYuanServiceStatus = z.infer<typeof siyuanServiceStatusSchema>
export const siyuanServiceStatusContract = Object.freeze({
  actionId: 'siyuan.service.status',
  effect: 'read' as const,
  inputSchema: z.object({}).strict(),
  outputSchema: siyuanServiceStatusSchema
})

export const siyuanServiceCheckResultSchema = z.object({
  url: z.string().url(), version: z.string().max(200), notebookCount: z.number().int().nonnegative(),
  verifiedRead: z.literal(true)
}).strict()
export type SiYuanServiceCheckResult = z.infer<typeof siyuanServiceCheckResultSchema>
export const siyuanServiceCheckContract = Object.freeze({
  actionId: 'siyuan.service.check', effect: 'read' as const,
  inputSchema: siyuanEditorRequestSchema.omit({ refresh: true }), outputSchema: siyuanServiceCheckResultSchema
})

/** `token: null` clears the stored token; an empty string is rejected so that a
 * cleared field can never be mistaken for a deliberate removal. The result is
 * the same status document the reader capability returns, never the token. */
export const siyuanServiceConfigureRequestSchema = z.object({
  mode: z.enum(['managed', 'custom']).optional(),
  url: z.string().trim().max(2_048).optional(),
  token: z.string().max(2_048).nullable().optional()
}).strict().refine(value => value.mode !== undefined || value.url !== undefined || value.token !== undefined)
export type SiYuanServiceConfigureRequest = z.infer<typeof siyuanServiceConfigureRequestSchema>
export const siyuanServiceConfigureContract = Object.freeze({
  actionId: 'siyuan.service.configure',
  effect: 'compute' as const,
  inputSchema: siyuanServiceConfigureRequestSchema,
  outputSchema: siyuanServiceStatusSchema
})

export const siyuanDocumentCreateRequestSchema = z.object({
  spaceId: cloudSpaceIdSchema.optional().describe('Required for managed cloud services. List spaces and choose the personal or project space explicitly; omit only for an explicitly configured custom service.'),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(1_000_000),
  notebook: z.string().regex(/^\d{14}-[a-z0-9]{7}$/u).optional(),
  notebookName: z.string().trim().min(1).max(100).default('SciForge 工作总结'),
  path: z.string().startsWith('/').max(1024).optional()
}).strict()
export const siyuanDocumentCreateResultSchema = z.object({
  id: z.string().regex(/^\d{14}-[a-z0-9]{7}$/u),
  url: z.string().url(),
  verified: z.literal(true)
}).strict()
export const siyuanDocumentCreateContract = Object.freeze({
  actionId: 'siyuan.document.create',
  effect: 'external-write' as const,
  inputSchema: siyuanDocumentCreateRequestSchema,
  outputSchema: siyuanDocumentCreateResultSchema
})

const blockIdPattern = /^\d{14}-[a-z0-9]{7}$/u

/** Agent-facing read path. A document is addressed either by its block id or by
 * its human path (`/SciForge/实验记录`), which is what the write path produces
 * and what a person reads in the SiYuan tree. `maxChars` keeps one huge document
 * from flooding the conversation; the result says whether it was cut. */
export const siyuanDocumentLookupReadRequestSchema = z.object({
  spaceId: cloudSpaceIdSchema.optional().describe('Required for managed cloud services. List spaces and choose the personal or project space explicitly; omit only for an explicitly configured custom service.'),
  id: z.string().regex(blockIdPattern).optional(),
  path: z.string().startsWith('/').max(1_024).optional(),
  notebook: z.string().regex(blockIdPattern).optional(),
  notebookName: z.string().trim().min(1).max(100).optional(),
  maxChars: z.number().int().min(200).max(3_000).default(1_000),
  offset: z.number().int().nonnegative().safe().default(0).describe('Start at 0. For continuation, copy nextOffset from the previous result and also pass its contentHash. Never guess an offset.'),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).optional().describe('Required when offset > 0. Copy contentHash from the previous read of this document; if content changes, restart at offset 0.')
}).strict()
export const siyuanDocumentReferenceSchema = z.object({
  id: z.string().regex(blockIdPattern),
  path: z.string().max(1_024),
  notebook: z.string().regex(blockIdPattern),
  title: z.string().max(1_024),
  updated: z.string().max(64)
}).strict()
export const siyuanDocumentReadResultSchema = siyuanDocumentReferenceSchema.extend({
  markdown: z.string().max(3_000),
  truncated: z.boolean(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  totalChars: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict()
export const siyuanDocumentOpenRequestSchema = siyuanDocumentLookupReadRequestSchema.pick({ spaceId: true, id: true, path: true, notebook: true, notebookName: true }).strict()
export const SIYUAN_DOCUMENT_RESOURCE_KIND = 'siyuan-document'
export const siyuanDocumentOpenContract = Object.freeze({
  actionId: 'siyuan.document.open', effect: 'read' as const,
  inputSchema: siyuanDocumentOpenRequestSchema,
  outputSchema: z.object({ resource: domainCapabilityResourceHandleSchema }).strict()
})
const documentReadPageSchema = siyuanDocumentLookupReadRequestSchema.pick({ offset: true, maxChars: true, contentHash: true }).strict()
export const siyuanDocumentReadRequestSchema = z.union([
  documentReadPageSchema.extend({ offset: z.literal(0).default(0) }),
  documentReadPageSchema.extend({
    offset: z.number().int().positive().safe().describe('Copy nextOffset from the previous read; contentHash is required.'),
    contentHash: documentReadPageSchema.shape.contentHash.unwrap()
  })
]).describe('Read the first page with offset 0; continue with both nextOffset and contentHash from the previous result. Keep resourceRef at the top level of sciforge_invoke.')
export const siyuanDocumentReadContract = Object.freeze({
  actionId: 'siyuan.document.read',
  effect: 'read' as const,
  inputSchema: siyuanDocumentReadRequestSchema,
  outputSchema: siyuanDocumentReadResultSchema
})

/** Discovery half of the read path: without it an Agent cannot learn the paths
 * that `siyuan.document.read` expects. */
export const siyuanDocumentSearchRequestSchema = z.object({
  spaceId: cloudSpaceIdSchema.optional().describe('Required for managed cloud services. List spaces and choose the personal or project space explicitly; omit only for an explicitly configured custom service.'),
  query: z.string().trim().min(1).max(200),
  notebook: z.string().regex(blockIdPattern).optional(),
  notebookName: z.string().trim().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).default(10)
}).strict()
export const siyuanDocumentSearchResultSchema = z.object({
  documents: z.array(siyuanDocumentReferenceSchema.omit({ title: true })).max(50)
}).strict()
export const siyuanDocumentSearchContract = Object.freeze({
  actionId: 'siyuan.document.search',
  effect: 'read' as const,
  inputSchema: siyuanDocumentSearchRequestSchema,
  outputSchema: siyuanDocumentSearchResultSchema
})

/** Agent-facing write path. Same durable writer, its own action id so the
 * system auto-archive capability keeps its narrow ui/system audience. */
export const siyuanDocumentComposeRequestSchema = z.object({
  spaceId: cloudSpaceIdSchema.optional().describe('Required for managed cloud services. List spaces and choose the personal or project space explicitly; omit only for an explicitly configured custom service.'),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(1_000_000),
  notebookName: z.string().trim().min(1).max(100).default('My Notebook'),
  path: z.string().startsWith('/').max(1024).optional()
}).strict()
export const siyuanDocumentComposeContract = Object.freeze({
  actionId: 'siyuan.document.compose',
  effect: 'external-write' as const,
  inputSchema: siyuanDocumentComposeRequestSchema,
  outputSchema: siyuanDocumentCreateResultSchema
})

/** Mutations are bound to the same resource as reading; no second target id. */
export const siyuanDocumentEditRequestSchema = z.object({
  markdown: z.string().max(1_000_000),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedUpdated: z.string().min(1).max(64).optional().describe('Copy updated from the read result; checked together with the content hash, which also detects same-second edits.'),
  operationId: z.string().min(1).max(200).optional().describe('Stable unique id for this editing step. Reuse on retries, including after re-reading. Use a new id for a new intention.')
}).strict()
export const siyuanDocumentEditResultSchema = siyuanDocumentReferenceSchema.extend({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  mode: z.enum(['replace', 'append', 'patch']),
  changed: z.boolean()
}).strict()
export const siyuanDocumentReplaceContract = Object.freeze({
  actionId: 'siyuan.document.replace', effect: 'external-write' as const,
  inputSchema: siyuanDocumentEditRequestSchema,
  outputSchema: siyuanDocumentEditResultSchema
})
export const siyuanDocumentAppendContract = Object.freeze({
  actionId: 'siyuan.document.append', effect: 'external-write' as const,
  inputSchema: siyuanDocumentEditRequestSchema.extend({ markdown: z.string().min(1).max(1_000_000) }).strict(),
  outputSchema: siyuanDocumentEditResultSchema
})

const section = z.string().min(1).max(500).describe('Exact unique heading text, without # markers. Only this section may change.')
const tableTarget = { section, tableIndex: z.number().int().nonnegative().max(100).default(0) }
export const siyuanDocumentPatchRequestSchema = z.object({
  expectedContentHash: siyuanDocumentEditRequestSchema.shape.expectedContentHash,
  expectedUpdated: z.string().min(1).max(64),
  operationId: z.string().min(1).max(200),
  changes: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), section, find: z.string().min(1).max(100_000), replace: z.string().min(1).max(100_000) }).strict(),
    z.object({ type: z.literal('table-cell'), ...tableTarget, row: z.number().int().positive().max(10_000), column: z.number().int().nonnegative().max(100), expected: z.string().max(10_000), value: z.string().max(10_000) }).strict(),
    z.object({ type: z.literal('table-append'), ...tableTarget, rows: z.array(z.array(z.string().max(10_000)).min(1).max(100)).min(1).max(100) }).strict()
  ])).min(1).max(100)
}).strict()
export const siyuanDocumentPatchContract = Object.freeze({
  actionId: 'siyuan.document.patch', effect: 'external-write' as const,
  inputSchema: siyuanDocumentPatchRequestSchema, outputSchema: siyuanDocumentEditResultSchema
})


export { siyuanNotebookListContract, siyuanDirectoryListContract } from './catalog-contract.js'
export { siyuanCommentListContract, siyuanCommentCreateContract, siyuanCommentReplyContract, siyuanCommentUpdateContract } from './comments-contract.js'

/** Resolves only the active native document in this chat's selected project. */
export const siyuanEditorDocumentContract = Object.freeze({
  actionId: 'siyuan.editor.document', effect: 'read' as const,
  inputSchema: z.object({ sessionId: z.string().min(1).max(1024), spaceId: cloudSpaceIdSchema.optional() }).strict(),
  outputSchema: z.object({ document: z.object({ resource: domainCapabilityResourceHandleSchema }).strict().nullable() }).strict()
})


export const siyuanSpaceListContract = Object.freeze({
  actionId: 'siyuan.space.list', effect: 'read' as const,
  inputSchema: z.object({}).strict(), outputSchema: cloudSpacesListResponseSchema
})
export const siyuanSpaceEnsureContract = Object.freeze({
  actionId: 'siyuan.space.ensure', effect: 'external-write' as const,
  inputSchema: cloudSpaceEnsureRequestSchema, outputSchema: cloudSpaceResponseSchema
})
