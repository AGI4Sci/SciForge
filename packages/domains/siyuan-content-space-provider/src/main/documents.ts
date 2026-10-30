import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { siyuanDocumentCreateRequestSchema, siyuanDocumentCreateResultSchema } from '../editor-contract.js'
import { SiYuanClient, SiYuanError } from './client.js'

/** One serialized local write path; receipts survive broker/process restarts. */
export function createDocumentWriter(input: {
  userDataDir: string
  client: () => Promise<{ client: SiYuanClient; baseUrl: string }>
}) {
  let queue: Promise<unknown> = Promise.resolve()
  const create = async (raw: unknown) => {
    const request = siyuanDocumentCreateRequestSchema.parse(raw)
    const path = request.path ?? `/${request.title.replace(/[\\/:*?"<>|\r\n]/gu, '_')}`
    if (path.split('/').some((part) => part === '..' || part === '.')) throw new SiYuanError('invalid_input')
    const key = createHash('sha256').update(JSON.stringify([request.notebook ?? request.notebookName, path])).digest('hex')
    const directory = join(input.userDataDir, 'siyuan-document-receipts')
    const file = join(directory, `${key}.json`)
    await mkdir(directory, { recursive: true })
    const persist = async (value: unknown) => {
      await writeFile(`${file}.tmp`, JSON.stringify(value), 'utf8')
      await rename(`${file}.tmp`, file)
    }
    let receipt: { notebook: string; id?: string } | undefined
    try { receipt = JSON.parse(await readFile(file, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const { client, baseUrl } = await input.client()
    if (receipt) {
      // A lost response may still have committed: reconcile, never repeat the write.
      const id = receipt.id ?? (await client.documentIds(receipt.notebook, path))[0]
      if (!id) throw new SiYuanError('outcome_unknown')
      await persist({ ...receipt, id })
      return siyuanDocumentCreateResultSchema.parse({ id, url: `${baseUrl}/` })
    }
    const notebook = request.notebook ?? (await client.listNotebooks())
      .find((item) => !item.closed && item.name === request.notebookName)?.id ??
      await client.createNotebook(request.notebookName)
    const existing = (await client.documentIds(notebook, path))[0]
    await persist({ notebook, ...(existing ? { id: existing } : {}) })
    const id = existing ?? await client.createDocument({ notebook, path, markdown: request.markdown })
    await persist({ notebook, id })
    return siyuanDocumentCreateResultSchema.parse({ id, url: `${baseUrl}/` })
  }
  return {
    create(raw: unknown) {
      const result = queue.then(() => create(raw))
      queue = result.catch(() => undefined)
      return result
    },
    async drain() { await queue }
  }
}
