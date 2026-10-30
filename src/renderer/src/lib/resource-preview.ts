import { z } from 'zod'
import type { DomainRendererResourcePreviewInput } from '@sciforge/domain-sdk/host'
import { capabilityResourceHandleSchema } from '../../../shared/capability-broker'

const inputSchema = z.object({
  resource: capabilityResourceHandleSchema,
  workspaceId: z.string().trim().min(1).max(4096).optional(),
  file: z.object({
    name: z.string().trim().min(1).max(1024),
    mimeType: z.string().trim().min(1).max(256),
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  }).strict()
}).strict()

export type ResourcePreviewSnapshot = Readonly<{
  id: number
  input: DomainRendererResourcePreviewInput
  sourceUrl: string
}>
let sequence = 0
let snapshot: ResourcePreviewSnapshot | null = null
const listeners = new Set<() => void>()

export function getResourcePreviewSnapshot(): ResourcePreviewSnapshot | null { return snapshot }
export function subscribeResourcePreview(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The Broker retains byte authorization; caller metadata is presentation only. */
export function openResourcePreview(input: DomainRendererResourcePreviewInput): boolean {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return false
  try {
    const sourceUrl = window.sciforge?.capabilities.resourceContentUrl({
      resource: parsed.data.resource,
      ...(parsed.data.workspaceId ? { workspaceId: parsed.data.workspaceId } : {})
    })
    if (!sourceUrl) return false
    snapshot = Object.freeze({
      id: ++sequence,
      input: Object.freeze({ ...parsed.data, resource: Object.freeze(parsed.data.resource), file: Object.freeze(parsed.data.file) }),
      sourceUrl
    })
    for (const listener of listeners) listener()
    return true
  } catch { return false }
}

export function closeResourcePreview(id: number): void {
  if (snapshot?.id !== id) return
  snapshot = null
  for (const listener of listeners) listener()
}
