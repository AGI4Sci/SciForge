import { createHash } from 'node:crypto'
import type { SiYuanClient } from './client.js'

export async function documentContent(client: SiYuanClient, id: string, signal?: AbortSignal) {
  const exported = await client.exportDocumentMarkdown(id, signal)
  const markdown = exported.markdown.replace(/\r\n/gu, '\n')
  return { markdown, updated: exported.updated, contentHash: createHash('sha256').update(markdown).digest('hex'),
    raw: exported.raw, conditionalWriteVersion: exported.conditionalWriteVersion }
}
