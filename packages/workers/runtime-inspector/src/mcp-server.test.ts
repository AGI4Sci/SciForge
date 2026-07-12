import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import {
  GIT_CHECKPOINT_RESOURCE_URI_TEMPLATE,
  GIT_DIFF_RESOURCE_URI_TEMPLATE,
  RUNTIME_HEALTH_RESOURCE_URI,
  gitCheckpointResourceUri
} from './contract.js'
import { createFakeLspServer } from './lsp-test-fixture.js'
import { createRuntimeInspectorMcpServer } from './mcp-server.js'
import { createRuntimeInspectorService, type RuntimeInspectorFetch } from './service.js'

const execFileAsync = promisify(execFile)

test('serves runtime inspector tools, structured errors, and resources over MCP', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-inspector-mcp-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const repo = join(tempRoot, 'repo')
  await mkdir(repo, { recursive: true })
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'runtime-inspector@example.test'])
  await git(repo, ['config', 'user.name', 'Runtime Inspector'])
  await writeFile(join(repo, 'tracked.txt'), 'initial\n', 'utf8')
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', 'index.ts'), 'export const value = 1\n', 'utf8')
  await writeFile(join(repo, 'report.tex'), '\\title{SciForge}\n', 'utf8')
  await git(repo, ['add', 'tracked.txt'])
  await git(repo, ['commit', '-m', 'initial'])
  const repoRealPath = await realpath(repo)
  await writeFile(join(repo, 'tracked.txt'), 'changed\n', 'utf8')

  const dataDir = join(tempRoot, 'app-data')
  await createCheckpointFixture(dataDir, repoRealPath)
  const fakeLsp = await createFakeLspServer(t)

  const service = createRuntimeInspectorService({
    workspaceRoot: repoRealPath,
    checkpointDataDir: dataDir,
    runtimeToken: 'secret-token',
    fetch: fakeRuntimeFetch(),
    lspServerCommand: fakeLsp.command,
    lspServerArgs: fakeLsp.args
  })
  const server = createRuntimeInspectorMcpServer(service)
  const client = new Client({ name: 'runtime-inspector-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    service.shutdown()
    await client.close()
    await server.close()
  })

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])

  const tools = await client.listTools()
  const toolNames = tools.tools.map((tool) => tool.name)
  assert.ok(toolNames.includes('gui_git_status'))
  assert.ok(toolNames.includes('gui_runtime_health'))
  assert.ok(toolNames.includes('gui_lsp_query'))
  assert.ok(toolNames.includes('gui_completion_check'))

  const status = await client.callTool({
    name: 'gui_git_status',
    arguments: {}
  })
  assert.equal(status.isError, undefined)
  assert.equal(asRecord(status.structuredContent).ok, true)
  assert.equal(asRecord(status.structuredContent).repositoryRoot, repoRealPath)

  const lsp = await client.callTool({
    name: 'gui_lsp_query',
    arguments: {
      workspace_root: repoRealPath,
      operation: 'hover',
      file_path: 'src/index.ts',
      line: 1,
      character: 1
    }
  })
  assert.equal(lsp.isError, undefined)
  assert.equal(asRecord(lsp.structuredContent).ok, true)
  assert.equal(asRecord(asRecord(lsp.structuredContent).result).contents, 'fake hover')

  const completion = await client.callTool({
    name: 'gui_completion_check',
    arguments: {
      files: [{
        path: 'report.tex',
        required: [{ pattern: 'SciForge' }],
        forbidden: [{ pattern: 'PLACEHOLDER', blocking: false }]
      }]
    }
  })
  assert.equal(completion.isError, undefined)
  assert.equal(asRecord(completion.structuredContent).passed, true)
  assert.equal(asRecord(asRecord(completion.structuredContent).boundaries).shellExecution, 'disabled')

  const templates = await client.listResourceTemplates()
  assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === GIT_DIFF_RESOURCE_URI_TEMPLATE))
  assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === GIT_CHECKPOINT_RESOURCE_URI_TEMPLATE))

  const healthResource = await client.readResource({ uri: RUNTIME_HEALTH_RESOURCE_URI })
  const health = JSON.parse(textContent(healthResource.contents[0])) as Record<string, unknown>
  assert.equal(health.ok, true)
  assert.equal(health.status, 'healthy')

  const checkpointResource = await client.readResource({ uri: gitCheckpointResourceUri('turn_test') })
  const checkpoint = JSON.parse(textContent(checkpointResource.contents[0])) as Record<string, unknown>
  assert.equal(checkpoint.ok, true)
  assert.equal(asRecord(checkpoint.checkpoint).checkpointId, 'turn_test')
})

async function createCheckpointFixture(dataDir: string, repo: string): Promise<void> {
  const checkpointDir = join(dataDir, 'git-checkpoints', 'turn_test')
  await mkdir(checkpointDir, { recursive: true })
  await writeFile(join(checkpointDir, 'metadata.json'), `${JSON.stringify({
    checkpointId: 'turn_test',
    runtimeId: 'sciforge',
    threadId: 'thread-1',
    workspaceRoot: repo,
    repositoryRoot: repo,
    branch: 'main',
    head: 'abcdef123456',
    createdAt: '2026-06-23T00:00:00.000Z',
    diffStat: 'tracked.txt | 1 +',
    status: 'available',
    untrackedFiles: []
  }, null, 2)}\n`, 'utf8')
  await writeFile(join(checkpointDir, 'staged.patch'), 'staged patch text\n', 'utf8')
  await writeFile(join(checkpointDir, 'unstaged.patch'), 'unstaged patch text\n', 'utf8')
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANG: 'C' }
  })
}

function fakeRuntimeFetch(): RuntimeInspectorFetch {
  return async (input) => {
    const url = String(input)
    if (url.endsWith('/healthz')) return jsonResponse({ ok: true })
    if (url.endsWith('/health')) return jsonResponse({ status: 'ok', service: 'kun', mode: 'serve' })
    if (url.endsWith('/v1/runtime/info')) return jsonResponse({ host: '127.0.0.1', port: 8899, capabilities: {} })
    if (url.endsWith('/v1/runtime/tools')) return jsonResponse({ providers: [] })
    return new Response('not found', { status: 404 })
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textContent(value: unknown): string {
  const record = asRecord(value)
  return typeof record.text === 'string' ? record.text : ''
}
