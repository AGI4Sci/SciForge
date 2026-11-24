import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { siyuanDocumentCreateRequestSchema, siyuanDocumentCreateResultSchema, siyuanDocumentEditRequestSchema, siyuanDocumentEditResultSchema, siyuanDocumentPatchRequestSchema } from '../editor-contract.js'
import { SiYuanClient, SiYuanError } from './client.js'
import { bodyMarkdown, comparableMarkdown } from './markdown.js'
import { documentContent } from './document-content.js'
import { withWriteReceipt } from './write-receipt.js'
import { applyChanges, assertDocumentProtection, patchChanges } from './document-protection.js'
import { documentStep } from './document-step.js'

const receiptSchema = z.object({
  version: z.literal(2), baseUrl: z.string(), path: z.string(), notebook: z.string(),
  requestHash: z.string(), id: z.string().optional()
}).strict()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** Native block updates propagate this attribute to the document and headings.
 * Retaining an old block timestamp would move their version backwards. */
function editTimestamp(previous: string): string {
  const date = new Date()
  const format = (value: Date) => [value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('')
  const now = format(date)
  if (now > previous) return now
  const next = new Date(Number(previous.slice(0, 4)), Number(previous.slice(4, 6)) - 1, Number(previous.slice(6, 8)),
    Number(previous.slice(8, 10)), Number(previous.slice(10, 12)), Number(previous.slice(12, 14)) + 1)
  return format(next)
}

/** One serialized local write path; receipts survive broker/process restarts. */
export function createDocumentWriter(input: {
  userDataDir: string
  client: (spaceId?: string) => Promise<{ client: SiYuanClient; baseUrl: string }>
}) {
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation)
    queue = result.catch(() => undefined)
    return result
  }
  const create = async (raw: unknown, destination: Awaited<ReturnType<typeof input.client>>, signal?: AbortSignal) => {
    if (signal?.aborted) throw new SiYuanError('cancelled')
    const request = siyuanDocumentCreateRequestSchema.parse(raw)
    const path = request.path ?? `/${request.title.replace(/[\\/:*?"<>|\r\n]/gu, '_')}`
    if (path.split('/').some((part) => part === '..' || part === '.')) throw new SiYuanError('invalid_input')
    const { client, baseUrl } = destination
    const requestHash = digest(comparableMarkdown(request.markdown))
    const key = digest(JSON.stringify([baseUrl, request.notebook ?? request.notebookName, path]))
    const directory = join(input.userDataDir, 'siyuan-document-receipts-v2')
    const file = join(directory, `${key}.json`)
    await mkdir(directory, { recursive: true })
    const persist = async (value: unknown) => {
      await writeFile(`${file}.tmp`, JSON.stringify(value), 'utf8')
      await rename(`${file}.tmp`, file)
    }
    let receipt: z.infer<typeof receiptSchema> | undefined
    try { receipt = receiptSchema.parse(JSON.parse(await readFile(file, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const verify = async (id: string, newlyCreated = false) => {
      let actual: Awaited<ReturnType<SiYuanClient['exportDocumentMarkdown']>>
      try { actual = await client.exportDocumentMarkdown(id, signal) }
      catch { throw new SiYuanError('outcome_unknown') }
      if (actual.path !== path || digest(comparableMarkdown(actual.markdown)) !== requestHash) {
        throw new SiYuanError(newlyCreated ? 'write_verification_failed' : 'document_conflict')
      }
      return siyuanDocumentCreateResultSchema.parse({ id, url: `${baseUrl}/`, verified: true })
    }
    const locate = async (notebook: string) => {
      const ids = await client.documentIds(notebook, path, signal)
      if (ids.length > 1) throw new SiYuanError('document_ambiguous')
      return ids[0]
    }
    if (receipt) {
      if (receipt.baseUrl !== baseUrl || receipt.path !== path || receipt.requestHash !== requestHash) {
        throw new SiYuanError('document_conflict')
      }
      // A lost response may still have committed. Reconcile content and identity,
      // never recreate a deleted/uncertain target or trust an old success receipt.
      const id = await locate(receipt.notebook)
      if (!id || (receipt.id && receipt.id !== id)) throw new SiYuanError('outcome_unknown')
      const result = await verify(id)
      await persist({ ...receipt, id })
      return result
    }
    let notebook = request.notebook
    if (!notebook) {
      const matches = (await client.listNotebooks(signal)).filter(item => !item.closed && item.name === request.notebookName)
      if (matches.length > 1) throw new SiYuanError('document_ambiguous')
      notebook = matches[0]?.id ?? await client.createNotebook(request.notebookName, signal)
    }
    const existing = await locate(notebook)
    const intent = { version: 2 as const, baseUrl, path, notebook, requestHash }
    if (existing) {
      const result = await verify(existing)
      await persist({ ...intent, id: existing })
      return result
    }
    await persist(intent)
    let id: string
    try { id = await client.createDocument({ notebook, path, markdown: request.markdown, signal }) }
    catch (error) {
      // Only explicit pre-commit rejections permit a fresh attempt. Lost replies
      // retain the intent for reconciliation after process/broker restart.
      if (error instanceof SiYuanError && ['unauthorized', 'invalid_input', 'api_error', 'cancelled'].includes(error.code)) await unlink(file)
      throw error
    }
    await persist({ ...intent, id })
    return verify(id, true)
  }
  return {
    create(raw: unknown, signal?: AbortSignal) {
      // Resolve now, before waiting behind another write, so changing settings
      // cannot reroute an already submitted request to another server.
      const request = siyuanDocumentCreateRequestSchema.parse(raw)
      const destination = input.client(request.spaceId)
      void destination.catch(() => undefined)
      return serialize(async () => create(raw, await destination, signal))
    },
    edit(id: string, raw: unknown, mode: 'replace' | 'append' | 'patch', binding: Readonly<{
      identity: string; spaceId?: string; endpoint: string; assertCurrent: () => void; signal?: AbortSignal
    }>) {
      const patch = mode === 'patch' ? siyuanDocumentPatchRequestSchema.parse(raw) : undefined
      const edit = mode !== 'patch' ? siyuanDocumentEditRequestSchema.parse(raw) : undefined
      const request = patch ?? edit!
      if (mode === 'append' && !edit!.markdown.trim()) throw new SiYuanError('invalid_input')
      return serialize(async () => {
        binding.assertCurrent()
        if (binding.signal?.aborted) throw new SiYuanError('cancelled')
        const { client, baseUrl } = await input.client(binding.spaceId)
        binding.assertCurrent()
        if (baseUrl !== binding.endpoint) throw new SiYuanError('invalid_configuration')
        const row = await client.documentMetadata(id, binding.signal)
        const before = await documentContent(client, id, binding.signal)
        binding.assertCurrent()
        const reference = { id, path: row.hpath, notebook: row.box,
          title: row.hpath.split('/').filter(Boolean).pop() ?? row.hpath, updated: before.updated }
        const semanticRequest = patch ? { mode, changes: patch.changes } : { mode, markdown: edit!.markdown }
        // Appending the same content is the same step unless the caller supplies
        // a new operationId to explicitly request another copy.
        const operationId = request.operationId ?? (mode === 'append' ? digest(comparableMarkdown(edit!.markdown)) : undefined)
        const step = operationId ? await documentStep(join(input.userDataDir, 'siyuan-document-steps'),
          [binding.identity, binding.spaceId, baseUrl, id, operationId], semanticRequest, before.markdown) : undefined
        if (step?.replay) return siyuanDocumentEditResultSchema.parse({ ...reference, mode, changed: false, contentHash: before.contentHash })
        if (before.contentHash !== request.expectedContentHash || request.expectedUpdated !== undefined && before.updated !== request.expectedUpdated) throw new SiYuanError('document_changed')
        const changes = patch ? patchChanges(before.markdown, patch) : undefined
        const target = changes ? applyChanges(before.markdown, changes) : mode === 'append' ? before.markdown.trimEnd() + '\n\n' + edit!.markdown : edit!.markdown
        if (!patch) assertDocumentProtection(before.markdown, target)
        if (comparableMarkdown(target) === comparableMarkdown(before.markdown)) {
          if (step && !step.replay) { await step.prepare(target); await step.confirm() }
          return siyuanDocumentEditResultSchema.parse({ ...reference, mode, changed: false, contentHash: before.contentHash })
        }
        if (before.conditionalWriteVersion !== 1) throw new SiYuanError('conditional_write_unsupported')
        const expectedDocument = { id, kramdown: before.raw }
        const updates: { id: string; markdown: string }[] = []
        if (changes) {
          const children = await client.childBlocks(id, binding.signal)
          const rawBlocks = await Promise.all(children.map(child => client.readDocument(child.id, binding.signal)))
          const current = await documentContent(client, id, binding.signal)
          if (current.contentHash !== before.contentHash || current.updated !== before.updated) throw new SiYuanError('document_changed')
          let cursor = 0
          const updated = editTimestamp(before.updated)
          const assigned = new Set<number>()
          for (let index = 0; index < children.length; index++) {
            const rawBlock = rawBlocks[index], content = bodyMarkdown(rawBlock).trim()
            if (!content) continue
            const start = before.markdown.indexOf(content, cursor), end = start + content.length
            if (start < cursor) throw new SiYuanError('edit_scope_invalid')
            cursor = end
            const selected = changes.flatMap((change, i) => {
              if (change.start >= start && change.end <= end) { assigned.add(i); return [{ ...change, start: change.start - start, end: change.end - start }] }
              return []
            })
            if (!selected.length) continue
            // Preserve this block's attributes; complex containers have nested
            // attributes and need their child addressed separately.
            const attrs = rawBlock.match(/^\{: .*\}$/gmu) ?? []
            if (attrs.length !== 1 || !attrs[0].includes(`id="${children[index].id}"`)) throw new SiYuanError('edit_scope_invalid')
            const attributes = /\supdated="[^"]*"/u.test(attrs[0])
              ? attrs[0].replace(/\supdated="[^"]*"/u, ` updated="${updated}"`)
              : attrs[0].replace(/\}$/u, `updated="${updated}"}`)
            updates.push({ id: children[index].id, markdown: applyChanges(content, selected) + '\n' + attributes })
          }
          if (assigned.size !== changes.length) throw new SiYuanError('edit_scope_invalid')
        }
        // Recheck after planning and before dispatch; never mutate from a stale
        // snapshot just because the earlier version check passed.
        const current = await documentContent(client, id, binding.signal)
        if (current.contentHash !== before.contentHash || current.updated !== before.updated) throw new SiYuanError('document_changed')
        if (binding.signal?.aborted) throw new SiYuanError('cancelled')
        const write = async () => {
          binding.assertCurrent()
          if (step && !step.replay) await step.prepare(target)
          try {
            if (mode === 'patch') await client.updateBlocks(updates, binding.signal, expectedDocument)
            else if (mode === 'append') await client.appendMarkdown(id, edit!.markdown, binding.signal, expectedDocument)
            else await client.replaceMarkdown(id, edit!.markdown, binding.signal, expectedDocument)
          } catch (error) {
            if (error instanceof SiYuanError && ['unauthorized', 'invalid_input', 'cancelled', 'document_changed'].includes(error.code)) {
              if (step && !step.replay) await step.reject()
              throw error
            }
            // A transport failure can follow a successful commit. Reconcile the
            // exact intended body instead of reporting an uncertain write that
            // is already verifiable.
            try {
              if (comparableMarkdown((await documentContent(client, id, binding.signal)).markdown) !== comparableMarkdown(target)) throw error
            } catch { throw new SiYuanError('outcome_unknown') }
          }
          try {
            binding.assertCurrent()
            const after = await documentContent(client, id, binding.signal)
            const metadata = await client.documentMetadata(id, binding.signal)
            binding.assertCurrent()
            if (comparableMarkdown(after.markdown) !== comparableMarkdown(target)) throw new SiYuanError('outcome_unknown')
            if (step && !step.replay) await step.confirm()
            return siyuanDocumentEditResultSchema.parse({ ...reference, path: metadata.hpath, updated: after.updated,
              mode, contentHash: after.contentHash, changed: after.contentHash !== before.contentHash })
          } catch { throw new SiYuanError('outcome_unknown') }
        }
        return step ? write() : withWriteReceipt(input.userDataDir, [binding.identity, binding.spaceId, baseUrl, id, mode, request], write)
      })
    },
    serialize,
    async drain() { await queue }
  }
}
