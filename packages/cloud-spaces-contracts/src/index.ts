import { z } from 'zod'

export const CLOUD_SPACES_ROUTE = '/v1/cloud-spaces' as const
export const CLOUD_SPACE_SESSION_ROUTE = '/v1/cloud-spaces/sessions' as const
export const CLOUD_SPACE_BOOTSTRAP_PATH = '/_sciforge/session' as const
export const cloudSpaceIdSchema = z.string().regex(/^spc_[a-f0-9]{32}$/u)
const projectId = z.string().regex(/^prj_[A-Za-z0-9_-]{1,160}$/u)
export const cloudSpaceScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal'), ownerUserId: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('project'), projectId }).strict()
])
export const cloudSpaceSchema = z.object({
  spaceId: cloudSpaceIdSchema,
  scope: cloudSpaceScopeSchema,
  status: z.enum(['queued', 'provisioning', 'ready', 'failed']),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  failure: z.object({ code: z.literal('provision_failed'), retryable: z.boolean() }).strict().optional()
}).strict()
export const cloudSpaceEnsureRequestSchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('personal') }).strict(),
    z.object({ kind: z.literal('project'), projectId }).strict()
  ]),
  retryFailed: z.boolean().optional()
}).strict()
export const cloudSpaceResponseSchema = z.object({ space: cloudSpaceSchema }).strict()
export const cloudSpacesListResponseSchema = z.object({ spaces: z.array(cloudSpaceSchema) }).strict()
export const cloudSpaceSessionRequestSchema = z.object({ spaceId: cloudSpaceIdSchema }).strict()
const address = z.url().max(2_048).superRefine((value, context) => {
  const url = new URL(value)
  const secure = url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!secure || url.username || url.password || url.search || url.hash) {
    context.addIssue({ code: 'custom', message: 'Space addresses must be HTTPS (or loopback HTTP) and must not carry credentials, query strings or fragments.' })
  }
})
export const cloudSpaceBootstrapRequestSchema = z.object({ code: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/u) }).strict()
/** Main-process-only grant: exchange bootstrapCode in a POST body, never a URL. */
export const cloudSpaceSessionGrantSchema = z.object({
  spaceId: cloudSpaceIdSchema,
  editorUrl: address,
  bootstrapUrl: address,
  bootstrapCode: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/u),
  expiresAt: z.iso.datetime()
}).strict().superRefine((value, context) => {
  const editor = new URL(value.editorUrl), bootstrap = new URL(value.bootstrapUrl)
  if (editor.origin !== bootstrap.origin || editor.pathname !== '/' || bootstrap.pathname !== CLOUD_SPACE_BOOTSTRAP_PATH) {
    context.addIssue({ code: 'custom', message: 'Bootstrap and editor must belong to the same space origin and canonical paths.' })
  }
})
export type CloudSpace = z.infer<typeof cloudSpaceSchema>
export type CloudSpaceScope = z.infer<typeof cloudSpaceScopeSchema>
export type CloudSpaceEnsureRequest = z.infer<typeof cloudSpaceEnsureRequestSchema>
export type CloudSpaceResponse = z.infer<typeof cloudSpaceResponseSchema>
export type CloudSpacesListResponse = z.infer<typeof cloudSpacesListResponseSchema>
export type CloudSpaceSessionRequest = z.infer<typeof cloudSpaceSessionRequestSchema>
export type CloudSpaceSessionGrant = z.infer<typeof cloudSpaceSessionGrantSchema>
