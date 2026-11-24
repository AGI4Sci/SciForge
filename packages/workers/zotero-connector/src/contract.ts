import { z } from 'zod'

/**
 * Narrow Zotero Web API v3 read and create-only contract.
 */

export const ZOTERO_API_VERSION = 3
export const ZOTERO_API_BASE_URL = 'https://api.zotero.org'
/** Zotero caps multi-object reads at 100 items per request. */
export const ZOTERO_MAX_PAGE_SIZE = 100

export const zoteroCredentialSchema = z.strictObject({
  userId: z.string().trim().regex(/^\d+$/u).min(1).max(32),
  apiKey: z.string().trim().min(1).max(256)
})
export type ZoteroCredential = z.infer<typeof zoteroCredentialSchema>

export const zoteroCreatorSchema = z.strictObject({
  creatorType: z.string().trim().min(1).max(64),
  name: z.string().trim().max(512).optional(),
  firstName: z.string().trim().max(256).optional(),
  lastName: z.string().trim().max(256).optional()
})

/** One normalized bibliography item; every other Zotero field is dropped. */
export const zoteroItemSchema = z.strictObject({
  key: z.string().trim().min(1).max(64),
  version: z.number().int().nonnegative(),
  itemType: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(4096),
  creators: z.array(zoteroCreatorSchema).max(500),
  date: z.string().trim().max(128).optional(),
  parsedDate: z.string().trim().max(32).optional(),
  doi: z.string().trim().max(256).optional(),
  publicationTitle: z.string().trim().max(1024).optional(),
  abstractNote: z.string().trim().max(100_000).optional()
})
export type ZoteroItem = z.infer<typeof zoteroItemSchema>

export const zoteroListItemsResultSchema = z.strictObject({
  items: z.array(zoteroItemSchema),
  totalResults: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
  nextStart: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean()
})
export type ZoteroListItemsResult = z.infer<typeof zoteroListItemsResultSchema>

export const zoteroListItemsInputSchema = z.strictObject({
  start: z.number().int().nonnegative().max(1_000_000).optional(),
  limit: z.number().int().positive().max(ZOTERO_MAX_PAGE_SIZE).optional()
})
export type ZoteroListItemsInput = z.infer<typeof zoteroListItemsInputSchema>

/**
 * One bibliography item to write to Zotero. The write surface is deliberately
 * small: item type, title, creators, date, DOI, publication title and an
 * optional abstract. Notes, tags and attachments cannot be written through
 * this contract.
 */
export const zoteroWritableItemSchema = z.strictObject({
  itemType: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(4096),
  creators: z.array(zoteroCreatorSchema).max(500),
  date: z.string().trim().max(128).optional(),
  DOI: z.string().trim().max(256).optional(),
  publicationTitle: z.string().trim().max(1024).optional(),
  abstractNote: z.string().trim().max(100_000).optional()
})
export type ZoteroWritableItem = z.infer<typeof zoteroWritableItemSchema>

export const zoteroWriteResultSchema = z.strictObject({
  successful: z.record(z.string(), z.object({
    key: z.string().trim().min(1).max(64),
    version: z.number().int().nonnegative()
  })),
  unchanged: z.record(z.string(), z.string()),
  failed: z.record(z.string(), z.strictObject({
    code: z.number().int().optional(),
    message: z.string().trim().max(2_000).optional()
  }))
})
export type ZoteroWriteResult = z.infer<typeof zoteroWriteResultSchema>
