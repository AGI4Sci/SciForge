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