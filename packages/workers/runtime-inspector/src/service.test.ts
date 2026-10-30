import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { createFakeLspServer } from './lsp-test-fixture.js'
import { createRuntimeInspectorService, type RuntimeInspectorFetch } from './service.js'

const execFileAsync = promisify(execFile)

test('inspects Git status, branches, and diff preview read-only', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-inspector-service-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const repo = await createGitRepo(tempRoot)
  const repoRealPath = await realpath(repo)
  await writeFile(join(repo, 'tracked.txt'), 'changed line\nsecond line\n', 'utf8')
  await writeFile(join(repo, 'untracked.txt'), 'new file\n', 'utf8')

  const service = createRuntimeInspectorService({
    workspaceRoot: repoRealPath,
    fetch: fakeRuntimeFetch()
  })

  const status = await service.gitStatus({ limit: 1 })
  assert.equal(status.ok, true)
  if (!status.ok) return
  assert.equal(status.repositoryRoot, repoRealPath)
  assert.ok(status.dirtyCount >= 2)
  assert.equal(status.entries.length, 1)
  assert.equal(status.truncated, true)

  const branches = await service.gitBranches({})
  assert.equal(branches.ok, true)
  if (!branches.ok) return
  assert.ok(branches.branches.some((item) => item.current))

  const diff = await service.gitDiffPreview({ max_bytes: 24 })
  assert.equal(diff.ok, true)
  if (!diff.ok) return
  assert.equal(diff.patch.offset, 0)
  assert.equal(diff.patch.truncated, true)
  assert.match(diff.stat, /tracked\.txt/)

  const rejectedDiff = await service.gitDiffPreview({ path: '../outside.txt' })
  assert.equal(rejectedDiff.ok, false)
  if (rejectedDiff.ok) return
  assert.equal(rejectedDiff.error.code, 'path_outside_repository')

  const failedDiagnostics = service.diagnostics()
  assert.equal(failedDiagnostics.ok, true)
  if (!failedDiagnostics.ok) return
  assert.equal(failedDiagnostics.health.status, 'degraded')
  assert.equal(failedDiagnostics.health.available, true)
  assert.match(failedDiagnostics.recentError ?? '', /path_outside_repository/)
  assert.ok(failedDiagnostics.capabilities.includes('gui_runtime_health'))

  await writeFile(join(repo, ':(top)literal.txt'), 'literal pathspec-looking file\n', 'utf8')
  const literalDiff = await service.gitDiffPreview({ path: ':(top)literal.txt' })
  assert.equal(literalDiff.ok, true)
  if (!literalDiff.ok) return
  assert.match(literalDiff.stat, /:\(top\)literal\.txt/)

  const recoveredDiagnostics = service.diagnostics()
  assert.equal(recoveredDiagnostics.ok, true)
  if (!recoveredDiagnostics.ok) return
  assert.equal(recoveredDiagnostics.health.status, 'healthy')
  assert.equal(recoveredDiagnostics.recentError, null)
})

test('reports runtime health, dependencies, redacted local runtime info, and LSP availability boundaries', async (t) => {
  const fakeLsp = await createFakeLspServer(t)
  const service = createRuntimeInspectorService({
    workspaceRoot: process.cwd(),
    modelRouterBaseUrl: 'http://127.0.0.1:3892/v1',
    runtimeBaseUrl: 'http://127.0.0.1:8899',
    runtimeToken: 'secret-token',
    fetch: fakeRuntimeFetch(),
    lspServerCommand: fakeLsp.command,
    lspServerArgs: fakeLsp.args
  })
  t.after(() => {
    service.shutdown()
  })

  const modelRouter = await service.runtimeModelRouterStatus({})
  assert.equal(modelRouter.ok, true)
  if (!modelRouter.ok) return
  assert.equal(modelRouter.health.status, 'healthy')
  assert.equal(modelRouter.managementUrl, 'http://127.0.0.1:3892/healthz')

  const localRuntime = await service.runtimeLocalStatus({ include_tools: true })
  assert.equal(localRuntime.ok, true)
  if (!localRuntime.ok) return
  assert.equal(localRuntime.health.status, 'healthy')
  assert.equal(localRuntime.lifecycleBoundary.processControl, 'not_exposed')
  assert.equal(localRuntime.runtimeInfo?.runtimeToken, '[redacted]')
  assert.equal(localRuntime.toolDiagnostics?.apiKey, '[redacted]')

  const health = await service.runtimeHealth({ include_tools: true })
  assert.equal(health.ok, true)
  if (!health.ok) return
  assert.equal(health.status, 'healthy')
  assert.equal(health.localRuntime.ok, true)

  const dependencies = await service.runtimeDependencyReport({ include_runtime_http: true })
  assert.equal(dependencies.ok, true)
  if (!dependencies.ok) return
  assert.ok(dependencies.dependencies.some((item) => item.id === 'git'))
  assert.ok(dependencies.dependencies.some((item) => item.id === 'typescript-language-server'))
  assert.ok(dependencies.dependencies.some((item) => item.id === 'model-router-http' && item.available))
  assert.ok(dependencies.dependencies.some((item) => item.id === 'local-runtime-http' && item.available))

  const lspStatus = await service.lspStatus({ workspace_root: process.cwd(), include_dependency_probe: true })
  assert.equal(lspStatus.ok, true)
  if (!lspStatus.ok) return
  assert.equal(lspStatus.available, true)
  assert.equal(lspStatus.status, 'available')
  assert.equal(lspStatus.lifecycle.longLivedServerStarted, false)
  assert.equal(lspStatus.boundaries.unsavedBuffers, 'rejected')
  assert.equal(lspStatus.boundaries.fileSource, 'saved_files_only')
  assert.equal(lspStatus.dependency?.status, 'configured_command')
})

test('runs TS/JS LSP queries through an injected long-lived server session', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'runtime-inspector-lsp-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspace = join(tempRoot, 'workspace')
  await mkdir(workspace, { recursive: true })
  const sourcePath = join(workspace, 'src', 'index.ts')
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(sourcePath, 'export function value() { return 42 }\nvalue()\n', 'utf8')
  await writeFile(join(workspace, 'notes.txt'), 'plain text\n', 'utf8')
  const workspaceRoot = await realpath(workspace)
  const realSourcePath = await realpath(sourcePath)
  const fakeLsp = await createFakeLspServer(t)
  const service = createRuntimeInspectorService({
    workspaceRoot,
    fetch: fakeRuntimeFetch(),
    lspServerCommand: fakeLsp.command,
    lspServerArgs: fakeLsp.args,
    lspCleanupDelayMs: 60_000,
    lspRequestTimeoutMs: 5_000
  })
  t.after(() => {
    service.shutdown()
  })

  const unsupported = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'hover',
    file_path: 'notes.txt',
    line: 1,
    character: 1
  })
  assert.equal(unsupported.ok, false)
  if (unsupported.ok) return
  assert.equal(unsupported.error.code, 'unsupported_language')
  assert.equal((await fakeLsp.readLog()).length, 0)

  const outsideWorkspace = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'hover',
    file_path: '../outside.ts',
    line: 1,
    character: 1
  })
  assert.equal(outsideWorkspace.ok, false)
  if (outsideWorkspace.ok) return
  assert.equal(outsideWorkspace.error.code, 'path_outside_repository')
  assert.equal((await fakeLsp.readLog()).length, 0)

  const statusBefore = await service.lspStatus({ workspace_root: workspaceRoot, include_dependency_probe: true })
  assert.equal(statusBefore.ok, true)
  if (!statusBefore.ok) return
  assert.equal(statusBefore.available, true)
  assert.equal(statusBefore.lifecycle.longLivedServerStarted, false)

  const hover = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'hover',
    file_path: 'src/index.ts',
    line: 1,
    character: 8
  })
  assert.equal(hover.ok, true)
  if (!hover.ok) return
  assert.equal(asRecord(hover.result).contents, 'fake hover')
  assert.equal(hover.filePath, realSourcePath)

  const definition = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'goToDefinition',
    file_path: 'src/index.ts',
    line: 2,
    character: 1
  })
  assert.equal(definition.ok, true)
  if (!definition.ok) return
  assert.equal(asRecord(definition.result).path, realSourcePath)

  const references = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'findReferences',
    file_path: 'src/index.ts',
    line: 2,
    character: 1
  })
  assert.equal(references.ok, true)
  if (!references.ok) return
  assert.equal(Array.isArray(references.result), true)
  assert.equal((references.result as unknown[]).length, 2)

  const documentSymbol = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'documentSymbol',
    file_path: 'src/index.ts'
  })
  assert.equal(documentSymbol.ok, true)
  if (!documentSymbol.ok) return
  assert.equal(asRecord((documentSymbol.result as unknown[])[0]).name, 'fakeDocumentSymbol')

  const workspaceSymbol = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'workspaceSymbol',
    query: 'fake'
  })
  assert.equal(workspaceSymbol.ok, true)
  if (!workspaceSymbol.ok) return
  assert.equal(asRecord((workspaceSymbol.result as unknown[])[0]).name, 'fakeWorkspaceSymbol')

  const implementation = await service.lspQuery({
    workspace_root: workspaceRoot,
    operation: 'goToImplementation',
    file_path: 'src/index.ts',
    line: 2,
    character: 1
  })
  assert.equal(implementation.ok, true)
  if (!implementation.ok) return
  assert.equal(asRecord(implementation.result).path, realSourcePath)

  const statusAfter = await service.lspStatus({ workspace_root: workspaceRoot, include_dependency_probe: true })
  assert.equal(statusAfter.ok, true)
  if (!statusAfter.ok) return
  assert.equal(statusAfter.status, 'running')
  assert.equal(statusAfter.lifecycle.longLivedServerStarted, true)
  assert.equal(statusAfter.lifecycle.activeSessionCount, 1)

  const log = await fakeLsp.readLog()
  assert.equal(log.filter((entry) => entry.method === 'initialize').length, 1)
})

async function createGitRepo(tempRoot: string): Promise<string> {
  const repo = join(tempRoot, 'repo')
  await mkdir(repo, { recursive: true })
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'runtime-inspector@example.test'])
  await git(repo, ['config', 'user.name', 'Runtime Inspector'])
  await writeFile(join(repo, 'tracked.txt'), 'initial line\n', 'utf8')
  await writeFile(join(repo, ':(top)literal.txt'), 'initial literal pathspec-looking file\n', 'utf8')
  await git(repo, ['--literal-pathspecs', 'add', 'tracked.txt', ':(top)literal.txt'])
  await git(repo, ['commit', '-m', 'initial'])
  return repo
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANG: 'C' }
  })
  return String(stdout)
}

function fakeRuntimeFetch(): RuntimeInspectorFetch {
  return async (input, init) => {
    const url = String(input)
    if (url.endsWith('/healthz')) {
      return jsonResponse({ ok: true })
    }
    if (url.endsWith('/health')) {
      return jsonResponse({ status: 'ok', service: 'kun', mode: 'serve' })
    }
    if (url.endsWith('/v1/runtime/info')) {
      assert.equal(init?.headers && 'Authorization' in init.headers, true)
      return jsonResponse({
        host: '127.0.0.1',
        port: 8899,
        runtimeToken: 'should-redact',
        capabilities: {}
      })
    }
    if (url.endsWith('/v1/runtime/tools')) {
      return jsonResponse({
        providers: [],
        apiKey: 'should-redact'
      })
    }
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
  assert.equal(typeof value, 'object')
  assert.notEqual(value, null)
  return value as Record<string, unknown>
}
