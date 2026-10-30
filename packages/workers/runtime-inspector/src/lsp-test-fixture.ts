import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type FakeLspServer = {
  command: string
  args: string[]
  logPath: string
  readLog: () => Promise<Array<Record<string, unknown>>>
}

type TestCleanup = {
  after(callback: () => void | Promise<void>): void
}

export async function createFakeLspServer(t: TestCleanup): Promise<FakeLspServer> {
  const root = await mkdtemp(join(tmpdir(), 'runtime-inspector-fake-lsp-'))
  const serverPath = join(root, 'fake-lsp.cjs')
  const logPath = join(root, 'fake-lsp.log')
  await writeFile(serverPath, fakeLspServerSource(), 'utf8')
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  return {
    command: process.execPath,
    args: [serverPath, logPath],
    logPath,
    readLog: async () => {
      const text = await readFile(logPath, 'utf8').catch(() => '')
      return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    }
  }
}

function fakeLspServerSource(): string {
  return `
const fs = require('node:fs')

const logPath = process.argv[2]
let buffer = Buffer.alloc(0)
let rootUri = ''
let lastUri = ''

function log(event) {
  if (!logPath) return
  fs.appendFileSync(logPath, JSON.stringify(event) + '\\n')
}

function send(message) {
  const body = JSON.stringify(message)
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\\r\\n\\r\\n' + body)
}

function range(line, character) {
  return {
    start: { line, character },
    end: { line, character: character + 5 }
  }
}

function fallbackUri() {
  return lastUri || (rootUri ? rootUri.replace(/\\/$/, '') + '/src/index.ts' : 'file:///workspace/src/index.ts')
}

function handle(message) {
  log({ method: message.method, hasId: message.id !== undefined })
  if (message.method === 'textDocument/didOpen') {
    lastUri = message.params && message.params.textDocument && message.params.textDocument.uri || lastUri
    return
  }
  if (message.method === 'textDocument/didClose') return
  if (message.method === 'initialized') return
  if (message.id === undefined) return

  const params = message.params || {}
  const textDocument = params.textDocument || {}
  const uri = textDocument.uri || fallbackUri()
  let result = null
  switch (message.method) {
    case 'initialize':
      rootUri = params.rootUri || ''
      result = {
        capabilities: {
          textDocumentSync: { openClose: true, change: 0 },
          definitionProvider: true,
          referencesProvider: true,
          hoverProvider: true,
          documentSymbolProvider: true,
          workspaceSymbolProvider: true,
          implementationProvider: true
        }
      }
      break
    case 'textDocument/definition':
      result = { uri, range: range(1, 2) }
      break
    case 'textDocument/references':
      result = [
        { uri, range: range(1, 2) },
        { uri, range: range(3, 4) }
      ]
      break
    case 'textDocument/hover':
      result = {
        contents: { kind: 'markdown', value: 'fake hover' },
        range: range(0, 0)
      }
      break
    case 'textDocument/documentSymbol':
      result = [{
        name: 'fakeDocumentSymbol',
        detail: 'fixture',
        kind: 12,
        range: range(0, 0),
        selectionRange: range(0, 0)
      }]
      break
    case 'workspace/symbol':
      result = [{
        name: 'fakeWorkspaceSymbol',
        kind: 12,
        containerName: 'workspace',
        location: { uri: fallbackUri(), range: range(0, 0) }
      }]
      break
    case 'textDocument/implementation':
      result = { uri, range: range(4, 2) }
      break
    default:
      result = null
      break
  }
  send({ jsonrpc: '2.0', id: message.id, result })
}

function processBuffer() {
  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n')
    if (headerEnd < 0) return
    const header = buffer.subarray(0, headerEnd).toString('utf8')
    const match = header.match(/Content-Length:\\s*(\\d+)/i)
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + length) return
    const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
    buffer = buffer.subarray(bodyStart + length)
    handle(JSON.parse(body))
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  processBuffer()
})
`
}
