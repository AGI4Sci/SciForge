import { z } from 'zod'
import { cloudSpaceIdSchema } from '@sciforge/cloud-spaces-contracts'

const blockIdPattern = /^\d{14}-[a-z0-9]{7}$/u

/** Paths returned by the SiYuan file tree, not human titles or local paths. */
export const siyuanTreePathSchema = z.string().max(8_192)
  .regex(/^(?:\/|(?:\/\d{14}-[a-z0-9]{7})+\.sy)$/u)
const catalogPageSchema = z.object({
  spaceId: cloudSpaceIdSchema.optional().describe('Required for managed cloud services; omit only for an explicitly configured custom service.'),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(100).default(50)
})
const catalogPageResult = {
  spaceId: cloudSpaceIdSchema.optional(),
  total: z.number().int().min(0),
  nextCursor: z.string().nullable()
}
export const siyuanNotebookListContract = Object.freeze({
  actionId: 'siyuan.notebook.list', effect: 'read' as const,
  inputSchema: catalogPageSchema.strict(),
  outputSchema: z.object({
    notebooks: z.array(z.object({
      id: z.string().regex(blockIdPattern), name: z.string(), closed: z.boolean()
    }).strict()).max(100),
    ...catalogPageResult
  }).strict()
})
export const siyuanDirectoryListContract = Object.freeze({
  actionId: 'siyuan.directory.list', effect: 'read' as const,
  inputSchema: catalogPageSchema.extend({
    notebook: z.string().regex(blockIdPattern),
    path: siyuanTreePathSchema.default('/')
  }).strict(),
  outputSchema: z.object({
    notebook: z.string().regex(blockIdPattern),
    path: siyuanTreePathSchema,
    scope: z.literal('direct-children'),
    documents: z.array(z.object({
      id: z.string().regex(blockIdPattern), title: z.string(),
      path: siyuanTreePathSchema, childCount: z.number().int().min(0)
    }).strict()).max(100),
    ...catalogPageResult
  }).strict()
})

