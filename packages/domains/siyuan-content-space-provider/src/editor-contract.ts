import { z } from 'zod'

/** Server mode only: SciForge connects to a SiYuan service and never starts or
 * ships one. The address is optional so the main process can fall back to the
 * service configured for the installation (`SIYUAN_BASE_URL`). */
export const siyuanEditorRequestSchema = z.object({
  url: z.string().trim().max(2_048).optional()
}).strict()
export const siyuanEditorResultSchema = z.object({ url: z.string().url() }).strict()
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
  visible: z.boolean()
}).strict()
export type SiYuanEditorViewport = z.infer<typeof siyuanEditorViewportSchema>

/** `url: null` detaches the native editor, so an idle page never keeps a hidden
 * child view attached behind the Host renderer. */
export const siyuanEditorPresentRequestSchema = z.object({
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
  url: z.string().max(2_048).nullable(),
  urlSource: z.enum(['configured', 'environment', 'none']),
  token: z.enum(['stored', 'environment', 'none']),
  tokenStorage: z.enum(['available', 'unavailable'])
}).strict()
export type SiYuanServiceStatus = z.infer<typeof siyuanServiceStatusSchema>
export const siyuanServiceStatusContract = Object.freeze({
  actionId: 'siyuan.service.status',
  effect: 'read' as const,
  inputSchema: z.object({}).strict(),
  outputSchema: siyuanServiceStatusSchema
})

/** `token: null` clears the stored token; an empty string is rejected so that a
 * cleared field can never be mistaken for a deliberate removal. The result is
 * the same status document the reader capability returns, never the token. */
export const siyuanServiceConfigureRequestSchema = z.object({
  token: z.string().max(2_048).nullable()
}).strict()
export const siyuanServiceConfigureContract = Object.freeze({
  actionId: 'siyuan.service.configure',
  effect: 'compute' as const,
  inputSchema: siyuanServiceConfigureRequestSchema,
  outputSchema: siyuanServiceStatusSchema
})

export const siyuanDocumentCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(1_000_000),
  notebook: z.string().regex(/^\d{14}-[a-z0-9]{7}$/u).optional(),
  notebookName: z.string().trim().min(1).max(100).default('SciForge 工作总结'),
  path: z.string().startsWith('/').max(1024).optional()
}).strict()
export const siyuanDocumentCreateResultSchema = z.object({
  id: z.string().regex(/^\d{14}-[a-z0-9]{7}$/u),
  url: z.string().url()
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
export const siyuanDocumentReadRequestSchema = z.object({
  id: z.string().regex(blockIdPattern).optional(),
  path: z.string().startsWith('/').max(1_024).optional(),
  notebook: z.string().regex(blockIdPattern).optional(),
  notebookName: z.string().trim().min(1).max(100).optional(),
  maxChars: z.number().int().min(200).max(200_000).default(20_000)
}).strict()
export const siyuanDocumentReferenceSchema = z.object({
  id: z.string().regex(blockIdPattern),
  path: z.string().max(1_024),
  notebook: z.string().regex(blockIdPattern),
  title: z.string().max(1_024),
  updated: z.string().max(64)
}).strict()
export const siyuanDocumentReadResultSchema = siyuanDocumentReferenceSchema.extend({
  markdown: z.string().max(200_000),
  truncated: z.boolean()
}).strict()
export const siyuanDocumentReadContract = Object.freeze({
  actionId: 'siyuan.document.read',
  effect: 'read' as const,
  inputSchema: siyuanDocumentReadRequestSchema,
  outputSchema: siyuanDocumentReadResultSchema
})

/** Discovery half of the read path: without it an Agent cannot learn the paths
 * that `siyuan.document.read` expects. */
export const siyuanDocumentSearchRequestSchema = z.object({
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