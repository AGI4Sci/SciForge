import { randomUUID } from 'node:crypto'
import { SiYuanClient, SiYuanError } from './client.js'

/** Explicit notebook target; no automatic writes into an arbitrary notebook. */
export async function runSiYuanSmoke(client: SiYuanClient, notebookId: string) {
  const version = await client.version()
  const notebooks = await client.listNotebooks()
  const notebook = notebooks.find((entry) => entry.id === notebookId && !entry.closed)
  if (!notebook) throw new SiYuanError('invalid_input')
  const runId = randomUUID()
  const title = `SCIFORGE-接入测试-${runId}`
  const initial = `SCIFORGE 初始写入 ${runId}`
  const appended = `SCIFORGE 追加写入 ${runId}`
  const documentId = await client.createDocument({
    notebook: notebookId, path: `/${title}`, markdown: `# ${title}\n\n${initial}`
  })
  try {
    await client.appendMarkdown(documentId, appended)
    const kramdown = await client.readDocument(documentId)
    if (!kramdown.includes(initial) || !kramdown.includes(appended)) {
      throw new SiYuanError('outcome_unknown')
    }
  } catch {
    // Keep the created document ID for recovery; never hide partial writes or recreate.
    throw new Error(`SiYuan smoke incomplete; inspect document ${documentId} before retrying.`)
  }
  return { version, notebookId, notebookName: notebook.name, documentId, title, verified: true }
}
