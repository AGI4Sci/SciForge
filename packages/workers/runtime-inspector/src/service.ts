import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path'
import { promisify } from 'node:util'
import { createConnection } from 'node:net'

import {
  GIT_BRANCHES_RESOURCE_URI,
  GIT_CHECKPOINTS_RESOURCE_URI,
  GIT_DIFF_RESOURCE_URI,
  GIT_STATUS_RESOURCE_URI,
  LSP_STATUS_RESOURCE_URI,
  RUNTIME_DEPENDENCIES_RESOURCE_URI,
  RUNTIME_HEALTH_RESOURCE_URI,
  RUNTIME_INSPECTOR_DEFAULT_DIFF_BYTES,
  RUNTIME_INSPECTOR_DEFAULT_RUNTIME_BASE_URL,
  RUNTIME_INSPECTOR_DEFAULT_LIMIT,
  RUNTIME_INSPECTOR_DEFAULT_MODEL_ROUTER_BASE_URL,
  RUNTIME_INSPECTOR_DEFAULT_PATCH_BYTES,
  RUNTIME_INSPECTOR_DEFAULT_TIMEOUT_MS,
  RUNTIME_INSPECTOR_DIAGNOSTICS_RESOURCE_URI,
  RUNTIME_INSPECTOR_MAX_DIFF_BYTES,
  RUNTIME_INSPECTOR_MAX_LIMIT,
  RUNTIME_INSPECTOR_MAX_PATCH_BYTES,
  RUNTIME_INSPECTOR_MAX_TIMEOUT_MS,
  RUNTIME_INSPECTOR_MCP_SERVER_VERSION,
  RUNTIME_INSPECTOR_WORKER_TRANSPORT,
  RUNTIME_LOCAL_RESOURCE_URI,
  RUNTIME_MODEL_ROUTER_RESOURCE_URI,
  RUNTIME_PORTS_RESOURCE_URI,
  RuntimeInspectorToolNames,
  GitBranchesInputSchema,
  GitCheckpointListInputSchema,
  GitCheckpointPreviewInputSchema,
  GitDiffPreviewInputSchema,
  GitStatusInputSchema,
  LspQueryInputSchema,
  LspStatusInputSchema,
  RuntimeDependencyReportInputSchema,
  RuntimeHealthInputSchema,
  RuntimeLocalStatusInputSchema,
  RuntimeModelRouterStatusInputSchema,
  RuntimePortsInputSchema,
  gitCheckpointResourceUri,
  gitDiffResourceUri,
  type GitBranchSummary,
  type GitBranchesInput,
  type GitBranchesResult,
  type GitCheckpointListInput,
  type GitCheckpointListResult,
  type GitCheckpointPreviewInput,
  type GitCheckpointPreviewResult,
  type GitCheckpointSummary,
  type GitDiffPreviewInput,
  type GitDiffPreviewResult,
  type GitDiffScope,
  type GitStatusEntry,
  type GitStatusInput,
  type GitStatusResult,
  type LspQueryInput,
  type LspQueryResult,
  type LspStatusInput,
  type LspStatusResult,
  type RuntimeDependency,
  type RuntimeDependencyReportInput,
  type RuntimeDependencyReportResult,
  type RuntimeEndpointStatus,
  type RuntimeHealthInput,
  type RuntimeHealthResult,
  type RuntimeInspectorAnyResult,
  type RuntimeInspectorDiagnosticsResult,
  type RuntimeInspectorErrorCode,
  type RuntimeInspectorFailure,
  type RuntimeLocalStatusInput,
  type RuntimeLocalStatusResult,
  type RuntimeModelRouterStatusInput,
  type RuntimeModelRouterStatusResult,
  type RuntimePortsInput,
  type RuntimePortsResult
} from './contract.js'
import { RuntimeInspectorLspService } from './lsp-session.js'
import {
  CompletionCheckError,
  CompletionChecksInputSchema,
  runCompletionChecks,
  type CompletionChecksInput,
  type CompletionChecksResult
} from './completion-checks.js'

const execFileAsync = promisify(execFile)

export type RuntimeInspectorFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type RuntimeInspectorServiceOptions = {
  workspaceRoot?: string
  checkpointDataDir?: string
  modelRouterBaseUrl?: string
  runtimeBaseUrl?: string
  runtimeToken?: string
  timeoutMs?: number
  fetch?: RuntimeInspectorFetch
  env?: NodeJS.ProcessEnv
  lspServerCommand?: string
  lspServerArgs?: string[]
  lspCleanupDelayMs?: number
  lspRequestTimeoutMs?: number
}

type GitRepository = {
  workspaceRoot: string
  repositoryRoot: string
}

type GitTextResult = {
  stdout: string
  stderr: string
}

type ProcessChunk = {
  text: string
  offset: number
  bytesRead: number
  truncated: boolean
  nextOffset?: number
  nextCursor?: string
}

type RuntimeEndpoint = {
  baseUrl: string
  url: URL | null
  port: number | null
  host: string
  local: boolean
}

type CheckpointMetadata = Omit<GitCheckpointSummary, 'resourceUri'> & {
  checkpointRef?: string
  untrackedFiles?: string[]
}

export class RuntimeInspectorService {
  readonly workspaceRoot?: string
  readonly checkpointDataDir?: string
  readonly modelRouterBaseUrl: string
  readonly runtimeBaseUrl: string
  readonly runtimeToken: string
  readonly timeoutMs: number
  private readonly fetchImpl: RuntimeInspectorFetch
  private readonly env: NodeJS.ProcessEnv
  private readonly lsp: RuntimeInspectorLspService
  private recentError: string | null = null

  constructor(options: RuntimeInspectorServiceOptions = {}) {
    this.env = options.env ?? process.env
    this.workspaceRoot = cleanOptionalPath(
      options.workspaceRoot ??
      this.env.SCIFORGE_RUNTIME_INSPECTOR_WORKSPACE_ROOT ??
      this.env.GUI_RUNTIME_INSPECTOR_WORKSPACE_ROOT
    )
    this.checkpointDataDir = cleanOptionalPath(
      options.checkpointDataDir ??
      this.env.SCIFORGE_RUNTIME_INSPECTOR_CHECKPOINT_DATA_DIR ??
      this.env.GUI_RUNTIME_INSPECTOR_CHECKPOINT_DATA_DIR
    )
    this.modelRouterBaseUrl = cleanOptionalString(
      options.modelRouterBaseUrl ??
      this.env.SCIFORGE_RUNTIME_INSPECTOR_MODEL_ROUTER_BASE_URL ??
      this.env.GUI_MODEL_ROUTER_BASE_URL
    ) || RUNTIME_INSPECTOR_DEFAULT_MODEL_ROUTER_BASE_URL
    this.runtimeBaseUrl = cleanOptionalString(
      options.runtimeBaseUrl ??
      this.env.SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_BASE_URL ??
      this.env.GUI_RUNTIME_BASE_URL
    ) || RUNTIME_INSPECTOR_DEFAULT_RUNTIME_BASE_URL
    this.runtimeToken = cleanOptionalString(
      options.runtimeToken ??
      this.env.SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_TOKEN ??
      this.env.GUI_RUNTIME_TOKEN
    ) ?? ''
    this.timeoutMs = clampInteger(
      options.timeoutMs ?? numberFromEnv(this.env.SCIFORGE_RUNTIME_INSPECTOR_TIMEOUT_MS, RUNTIME_INSPECTOR_DEFAULT_TIMEOUT_MS),
      250,
      RUNTIME_INSPECTOR_MAX_TIMEOUT_MS
    )
    const fetchImpl = options.fetch ?? globalThis.fetch
    this.fetchImpl = typeof fetchImpl === 'function'
      ? fetchImpl.bind(globalThis) as RuntimeInspectorFetch
      : async () => {
          throw serviceError('runtime_unavailable', 'No fetch implementation is available.', true, 'Run this worker on Node.js with global fetch support.')
        }
    this.lsp = new RuntimeInspectorLspService({
      env: this.env,
      serverCommand: options.lspServerCommand,
      serverArgs: options.lspServerArgs,
      cleanupDelayMs: options.lspCleanupDelayMs,
      requestTimeoutMs: options.lspRequestTimeoutMs
    })
  }

  diagnostics(): RuntimeInspectorDiagnosticsResult {
    return {
      ok: true,
      version: RUNTIME_INSPECTOR_MCP_SERVER_VERSION,
      transport: RUNTIME_INSPECTOR_WORKER_TRANSPORT,
      health: runtimeInspectorWorkerHealth(this.recentError),
      recentError: this.recentError,
      capabilities: [...RuntimeInspectorToolNames],
      resources: [
        RUNTIME_INSPECTOR_DIAGNOSTICS_RESOURCE_URI,
        GIT_STATUS_RESOURCE_URI,
        GIT_BRANCHES_RESOURCE_URI,
        GIT_DIFF_RESOURCE_URI,
        GIT_CHECKPOINTS_RESOURCE_URI,
        RUNTIME_PORTS_RESOURCE_URI,
        RUNTIME_HEALTH_RESOURCE_URI,
        RUNTIME_DEPENDENCIES_RESOURCE_URI,
        RUNTIME_MODEL_ROUTER_RESOURCE_URI,
        RUNTIME_LOCAL_RESOURCE_URI,
        LSP_STATUS_RESOURCE_URI
      ],
      configured: {
        ...(this.workspaceRoot ? { workspaceRoot: this.workspaceRoot } : {}),
        ...(this.checkpointDataDir ? { checkpointDataDir: this.checkpointDataDir } : {}),
        modelRouterBaseUrl: this.modelRouterBaseUrl,
        runtimeBaseUrl: this.runtimeBaseUrl,
        runtimeTokenConfigured: this.runtimeToken.trim().length > 0
      }
    }
  }

  async gitStatus(input: GitStatusInput = {}): Promise<GitStatusResult> {
    const parsed = GitStatusInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const repository = await this.resolveGitRepository(parsed.data.workspace_root)
      const branch = (await runGitText(repository.repositoryRoot, ['branch', '--show-current'])).stdout.trim() || null
      const head = (await runGitText(repository.repositoryRoot, ['rev-parse', '--short=12', 'HEAD'])).stdout.trim() || null
      const statusArgs = [
        'status',
        '--porcelain=v1',
        '-b',
        parsed.data.include_untracked === false ? '--untracked-files=no' : '--untracked-files=normal'
      ]
      const lines = (await runGitText(repository.repositoryRoot, statusArgs, { maxBuffer: 2 * 1024 * 1024 })).stdout
        .split('\n')
      const entries = lines
        .filter((line) => line.trim().length > 0 && !line.startsWith('## '))
        .map(parseStatusEntry)
      const limit = limitFor(parsed.data.limit)
      const offset = decodeCursor(parsed.data.cursor)
      const page = entries.slice(offset, offset + limit)
      const nextCursor = offset + limit < entries.length ? String(offset + limit) : undefined
      return {
        ok: true,
        workspaceRoot: repository.workspaceRoot,
        repositoryRoot: repository.repositoryRoot,
        currentBranch: branch,
        head,
        dirtyCount: entries.length,
        entries: page,
        limit,
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
        truncated: nextCursor !== undefined,
        resourceUri: GIT_STATUS_RESOURCE_URI
      }
    })
  }

  async gitBranches(input: GitBranchesInput = {}): Promise<GitBranchesResult> {
    const parsed = GitBranchesInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const repository = await this.resolveGitRepository(parsed.data.workspace_root)
      const currentBranch = (await runGitText(repository.repositoryRoot, ['branch', '--show-current'])).stdout.trim() || null
      const refs = parsed.data.include_remote === true
        ? ['refs/heads', 'refs/remotes']
        : ['refs/heads']
      const stdout = (await runGitText(repository.repositoryRoot, [
        'for-each-ref',
        '--format=%(refname)%09%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(HEAD)%09%(committerdate:iso8601)',
        ...refs
      ], { maxBuffer: 2 * 1024 * 1024 })).stdout
      const branches = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseBranchLine)
        .filter((branch): branch is GitBranchSummary => branch !== null)
      const limit = limitFor(parsed.data.limit)
      const offset = decodeCursor(parsed.data.cursor)
      const page = branches.slice(offset, offset + limit)
      const nextCursor = offset + limit < branches.length ? String(offset + limit) : undefined
      return {
        ok: true,
        workspaceRoot: repository.workspaceRoot,
        repositoryRoot: repository.repositoryRoot,
        currentBranch,
        branches: page,
        total: branches.length,
        limit,
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
        truncated: nextCursor !== undefined,
        resourceUri: GIT_BRANCHES_RESOURCE_URI
      }
    })
  }

  async gitDiffPreview(input: GitDiffPreviewInput = {}): Promise<GitDiffPreviewResult> {
    const parsed = GitDiffPreviewInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const request = parsed.data
      const repository = await this.resolveGitRepository(request.workspace_root)
      const path = normalizeGitPath(request.path, repository.repositoryRoot)
      const scope = request.scope ?? 'unstaged'
      const stat = (await runGitText(repository.repositoryRoot, diffArgs(scope, ['--stat', '--summary'], path), {
        maxBuffer: 256 * 1024
      })).stdout.trim()
      const maxBytes = clampInteger(
        request.max_bytes ?? RUNTIME_INSPECTOR_DEFAULT_DIFF_BYTES,
        1,
        RUNTIME_INSPECTOR_MAX_DIFF_BYTES
      )
      const offset = decodeCursor(request.cursor)
      const patch = await runGitChunk(
        repository.repositoryRoot,
        diffArgs(scope, [`--unified=${request.context_lines ?? 3}`], path),
        { offset, maxBytes, timeoutMs: this.timeoutMs }
      )
      return {
        ok: true,
        workspaceRoot: repository.workspaceRoot,
        repositoryRoot: repository.repositoryRoot,
        scope,
        ...(path ? { path } : {}),
        stat,
        patch,
        resourceUri: gitDiffResourceUri(path)
      }
    })
  }

  async gitCheckpointList(input: GitCheckpointListInput = {}): Promise<GitCheckpointListResult> {
    const parsed = GitCheckpointListInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const checkpointDataDir = this.resolveCheckpointDataDir(parsed.data.checkpoint_data_dir)
      const checkpointRoot = join(checkpointDataDir, 'git-checkpoints')
      const entries = await readdir(checkpointRoot, { withFileTypes: true }).catch(() => [])
      const checkpoints: GitCheckpointSummary[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const metadata = await readCheckpointMetadata(checkpointDataDir, entry.name)
        if (!metadata) continue
        const summary = publicCheckpoint(metadata)
        if (parsed.data.runtime_id && summary.runtimeId !== parsed.data.runtime_id) continue
        if (parsed.data.thread_id && summary.threadId !== parsed.data.thread_id) continue
        if (parsed.data.workspace_root && normalizeComparablePath(summary.workspaceRoot) !== normalizeComparablePath(parsed.data.workspace_root)) continue
        checkpoints.push(summary)
      }
      checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const limit = limitFor(parsed.data.limit)
      const offset = decodeCursor(parsed.data.cursor)
      const page = checkpoints.slice(offset, offset + limit)
      const nextCursor = offset + limit < checkpoints.length ? String(offset + limit) : undefined
      return {
        ok: true,
        checkpointDataDir,
        checkpoints: page,
        total: checkpoints.length,
        limit,
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(nextCursor ? { nextCursor } : {}),
        truncated: nextCursor !== undefined,
        resourceUri: GIT_CHECKPOINTS_RESOURCE_URI
      }
    })
  }

  async gitCheckpointPreview(input: GitCheckpointPreviewInput): Promise<GitCheckpointPreviewResult> {
    const parsed = GitCheckpointPreviewInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const request = parsed.data
      const checkpointId = safeCheckpointId(request.checkpoint_id)
      const checkpointDataDir = this.resolveCheckpointDataDir(request.checkpoint_data_dir)
      const metadata = await readCheckpointMetadata(checkpointDataDir, checkpointId)
      if (!metadata) {
        throw serviceError('checkpoint_not_found', `Git checkpoint not found: ${checkpointId}`, false, 'Use gui_git_checkpoint_list to choose an available checkpoint id.')
      }
      const maxBytes = clampInteger(
        request.max_patch_bytes ?? RUNTIME_INSPECTOR_DEFAULT_PATCH_BYTES,
        1,
        RUNTIME_INSPECTOR_MAX_PATCH_BYTES
      )
      const includePatches = request.include_patches !== false
      const stagedPatch = includePatches
        ? await readCheckpointTextFileChunk(checkpointDataDir, checkpointId, 'staged.patch', request.staged_offset ?? 0, maxBytes)
        : undefined
      const unstagedPatch = includePatches
        ? await readCheckpointTextFileChunk(checkpointDataDir, checkpointId, 'unstaged.patch', request.unstaged_offset ?? 0, maxBytes)
        : undefined
      return {
        ok: true,
        checkpointDataDir,
        checkpoint: publicCheckpoint(metadata),
        ...(stagedPatch ? { stagedPatch } : {}),
        ...(unstagedPatch ? { unstagedPatch } : {}),
        untrackedFiles: metadata.untrackedFiles ?? [],
        resourceUri: gitCheckpointResourceUri(checkpointId)
      }
    })
  }

  async runtimePorts(input: RuntimePortsInput = {}): Promise<RuntimePortsResult> {
    const parsed = RuntimePortsInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const endpoints = [
        endpointSummary('model-router', 'Model Router', this.modelRouterBaseUrl),
        endpointSummary('local-runtime', 'Local Runtime', this.runtimeBaseUrl)
      ] as const
      const ports = await Promise.all(endpoints.map(async (endpoint) => {
        const item = {
          id: endpoint.id,
          label: endpoint.label,
          baseUrl: endpoint.endpoint.baseUrl,
          host: endpoint.endpoint.host,
          port: endpoint.endpoint.port,
          configured: endpoint.endpoint.url !== null,
          local: endpoint.endpoint.local
        }
        if (parsed.data.include_reachability !== true || !endpoint.endpoint.port || !endpoint.endpoint.local) {
          return item
        }
        const reachability = await checkTcpPort(endpoint.endpoint.host, endpoint.endpoint.port, this.timeoutMs)
        return {
          ...item,
          reachable: reachability.ok,
          ...(reachability.reason ? { reason: reachability.reason } : {})
        }
      }))
      return {
        ok: true,
        ports,
        resourceUri: RUNTIME_PORTS_RESOURCE_URI
      }
    })
  }

  async runtimeHealth(input: RuntimeHealthInput = {}): Promise<RuntimeHealthResult> {
    const parsed = RuntimeHealthInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const [modelRouter, localRuntime] = await Promise.all([
        this.runtimeModelRouterStatus({}),
        this.runtimeLocalStatus({ include_tools: parsed.data.include_tools })
      ])
      const statuses = [
        modelRouter.ok ? modelRouter.health.status : 'unavailable',
        localRuntime.ok ? localRuntime.health.status : 'unavailable'
      ]
      const status = statuses.every((item) => item === 'healthy')
        ? 'healthy'
        : statuses.some((item) => item === 'healthy' || item === 'degraded' || item === 'auth_required')
          ? 'degraded'
          : 'unavailable'
      return {
        ok: true,
        status,
        modelRouter,
        localRuntime,
        resourceUri: RUNTIME_HEALTH_RESOURCE_URI
      }
    })
  }

  async runtimeDependencyReport(input: RuntimeDependencyReportInput = {}): Promise<RuntimeDependencyReportResult> {
    const parsed = RuntimeDependencyReportInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const dependencies: RuntimeDependency[] = [
        {
          id: 'node',
          available: true,
          version: process.version
        },
        await gitDependency(),
        await this.lsp.dependency(parsed.data.workspace_root ?? this.workspaceRoot),
        checkpointDependency(this.checkpointDataDir),
        {
          id: 'fetch',
          available: typeof this.fetchImpl === 'function',
          status: typeof this.fetchImpl === 'function' ? 'available' : 'missing'
        }
      ]
      if (parsed.data.include_runtime_http === true) {
        const [modelRouter, localRuntime] = await Promise.all([
          this.runtimeModelRouterStatus({}),
          this.runtimeLocalStatus({})
        ])
        dependencies.push({
          id: 'model-router-http',
          available: modelRouter.ok && modelRouter.health.reachable,
          status: modelRouter.ok ? modelRouter.health.status : 'error',
          reason: modelRouter.ok ? modelRouter.health.message : modelRouter.error.reason
        })
        dependencies.push({
          id: 'local-runtime-http',
          available: localRuntime.ok && localRuntime.health.reachable,
          status: localRuntime.ok ? localRuntime.health.status : 'error',
          reason: localRuntime.ok ? localRuntime.health.message : localRuntime.error.reason
        })
      }
      return {
        ok: true,
        generatedAt: new Date().toISOString(),
        dependencies,
        resourceUri: RUNTIME_DEPENDENCIES_RESOURCE_URI
      }
    })
  }

  async runtimeModelRouterStatus(input: RuntimeModelRouterStatusInput = {}): Promise<RuntimeModelRouterStatusResult> {
    const parsed = RuntimeModelRouterStatusInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const endpoint = parseEndpoint(this.modelRouterBaseUrl)
      if (!endpoint.url) {
        return {
          ok: true,
          baseUrl: this.modelRouterBaseUrl,
          managementUrl: '',
          port: null,
          health: {
            status: 'not_configured',
            reachable: false,
            message: 'Model Router base URL is not a valid URL.'
          },
          resourceUri: RUNTIME_MODEL_ROUTER_RESOURCE_URI
        }
      }
      const managementUrl = modelRouterManagementUrl(endpoint.url, '/healthz')
      const response = await fetchEndpoint(this.fetchImpl, managementUrl, {
        timeoutMs: this.timeoutMs
      })
      return {
        ok: true,
        baseUrl: endpoint.baseUrl,
        managementUrl,
        port: endpoint.port,
        health: modelRouterHealthFromResponse(response),
        resourceUri: RUNTIME_MODEL_ROUTER_RESOURCE_URI
      }
    })
  }

  async runtimeLocalStatus(input: RuntimeLocalStatusInput = {}): Promise<RuntimeLocalStatusResult> {
    const parsed = RuntimeLocalStatusInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const endpoint = parseEndpoint(this.runtimeBaseUrl)
      if (!endpoint.url) {
        return {
          ok: true,
          baseUrl: this.runtimeBaseUrl,
          port: null,
          health: {
            status: 'not_configured',
            reachable: false,
            message: 'Local runtime base URL is not a valid URL.'
          },
          lifecycleBoundary: runtimeLifecycleBoundary(),
          resourceUri: RUNTIME_LOCAL_RESOURCE_URI
        }
      }

      const healthUrl = new URL('/health', endpoint.url).toString()
      const healthResponse = await fetchEndpoint(this.fetchImpl, healthUrl, { timeoutMs: this.timeoutMs })
      const health = localRuntimeHealthFromResponse(healthResponse)
      const headers = this.runtimeToken.trim()
        ? { Authorization: `Bearer ${this.runtimeToken.trim()}` }
        : undefined
      const runtimeInfo = headers
        ? await fetchJsonEndpoint(this.fetchImpl, new URL('/v1/runtime/info', endpoint.url).toString(), {
            headers,
            timeoutMs: this.timeoutMs
          })
        : null
      const toolDiagnostics = parsed.data.include_tools === true && headers
        ? await fetchJsonEndpoint(this.fetchImpl, new URL('/v1/runtime/tools', endpoint.url).toString(), {
            headers,
            timeoutMs: this.timeoutMs
          })
        : null
      const authHealth: RuntimeEndpointStatus = !headers && health.status === 'healthy'
        ? {
            status: 'auth_required',
            reachable: true,
            message: 'Local runtime health is reachable; runtime info requires a bearer token.'
          }
        : health
      return {
        ok: true,
        baseUrl: endpoint.baseUrl,
        port: endpoint.port,
        health: runtimeInfo?.status === 401 || runtimeInfo?.status === 403
          ? {
              status: 'auth_required',
              reachable: true,
              statusCode: runtimeInfo.status,
              message: 'Local runtime info rejected the configured bearer token.'
            }
          : authHealth,
        ...(runtimeInfo?.ok && isRecord(runtimeInfo.body) ? { runtimeInfo: redactSecrets(runtimeInfo.body) } : {}),
        ...(toolDiagnostics?.ok && isRecord(toolDiagnostics.body) ? { toolDiagnostics: redactSecrets(toolDiagnostics.body) } : {}),
        lifecycleBoundary: runtimeLifecycleBoundary(),
        resourceUri: RUNTIME_LOCAL_RESOURCE_URI
      }
    })
  }

  async lspStatus(input: LspStatusInput = {}): Promise<LspStatusResult> {
    const parsed = LspStatusInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const workspaceRoot = parsed.data.workspace_root
        ? await resolveExistingPath(parsed.data.workspace_root)
        : this.workspaceRoot
      return this.lsp.status(workspaceRoot, parsed.data.include_dependency_probe === true)
    })
  }

  async completionChecks(input: CompletionChecksInput): Promise<CompletionChecksResult> {
    const parsed = CompletionChecksInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const workspaceRoot = await this.resolveWorkspaceRoot(parsed.data.workspace_root)
      try {
        return await runCompletionChecks(parsed.data, workspaceRoot)
      } catch (error) {
        if (error instanceof CompletionCheckError) {
          throw serviceError(
            error.code,
            error.message,
            error.code === 'file_read_failed',
            error.suggestion,
            error.details
          )
        }
        throw error
      }
    })
  }

  async lspQuery(input: LspQueryInput, options: { signal?: AbortSignal } = {}): Promise<LspQueryResult> {
    const parsed = LspQueryInputSchema.safeParse(input)
    if (!parsed.success) return this.invalidRequest(parsed.error.message)

    return this.capture(async () => {
      const workspaceRoot = await this.resolveWorkspaceRoot(parsed.data.workspace_root)
      return this.lsp.query({ ...parsed.data, workspace_root: workspaceRoot }, options)
    })
  }

  shutdown(): void {
    this.lsp.shutdown()
  }

  private resolveCheckpointDataDir(input?: string): string {
    const value = cleanOptionalPath(input) ?? this.checkpointDataDir
    if (!value) {
      throw serviceError(
        'checkpoint_data_dir_required',
        'Checkpoint data directory is required to inspect saved Git checkpoints.',
        false,
        'Pass checkpoint_data_dir or set SCIFORGE_RUNTIME_INSPECTOR_CHECKPOINT_DATA_DIR to the app userData directory.'
      )
    }
    return resolve(expandHomePath(value))
  }

  private async resolveGitRepository(workspaceRootInput?: string): Promise<GitRepository> {
    const workspaceRoot = await this.resolveWorkspaceRoot(workspaceRootInput)
    try {
      const repositoryRoot = (await runGitText(workspaceRoot, ['rev-parse', '--show-toplevel'])).stdout.trim()
      if (!repositoryRoot) {
        throw serviceError('not_git_repo', 'The working directory is not a Git repository.', false, 'Choose a workspace inside a Git repository.')
      }
      return {
        workspaceRoot,
        repositoryRoot: await resolveExistingPath(repositoryRoot)
      }
    } catch (error) {
      if (isServiceError(error)) throw error
      throw gitServiceError(error)
    }
  }

  private async resolveWorkspaceRoot(input?: string): Promise<string> {
    const value = cleanOptionalPath(input) ?? this.workspaceRoot
    if (!value) {
      throw serviceError(
        'workspace_root_required',
        'A workspace root is required for this Git or LSP operation.',
        false,
        'Pass workspace_root or start the worker with --workspace-root.'
      )
    }
    return resolveExistingPath(value)
  }

  private async capture<T extends RuntimeInspectorAnyResult>(
    operation: () => Promise<T>
  ): Promise<T | RuntimeInspectorFailure> {
    try {
      const result = await operation()
      this.recentError = null
      return result
    } catch (error) {
      const failure = failureFromUnknown(error)
      this.recentError = recentErrorText(failure)
      return failure
    }
  }

  private invalidRequest(reason: string): RuntimeInspectorFailure {
    const failure = invalidRequest(reason)
    this.recentError = recentErrorText(failure)
    return failure
  }
}

export function createRuntimeInspectorService(options: RuntimeInspectorServiceOptions = {}): RuntimeInspectorService {
  return new RuntimeInspectorService(options)
}

export function runtimeInspectorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeInspectorServiceOptions {
  return {
    workspaceRoot: cleanOptionalPath(env.SCIFORGE_RUNTIME_INSPECTOR_WORKSPACE_ROOT ?? env.GUI_RUNTIME_INSPECTOR_WORKSPACE_ROOT),
    checkpointDataDir: cleanOptionalPath(env.SCIFORGE_RUNTIME_INSPECTOR_CHECKPOINT_DATA_DIR ?? env.GUI_RUNTIME_INSPECTOR_CHECKPOINT_DATA_DIR),
    modelRouterBaseUrl: cleanOptionalString(env.SCIFORGE_RUNTIME_INSPECTOR_MODEL_ROUTER_BASE_URL ?? env.GUI_MODEL_ROUTER_BASE_URL),
    runtimeBaseUrl: cleanOptionalString(env.SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_BASE_URL ?? env.GUI_RUNTIME_BASE_URL),
    runtimeToken: cleanOptionalString(env.SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_TOKEN ?? env.GUI_RUNTIME_TOKEN),
    timeoutMs: numberFromEnv(env.SCIFORGE_RUNTIME_INSPECTOR_TIMEOUT_MS, RUNTIME_INSPECTOR_DEFAULT_TIMEOUT_MS),
    env
  }
}

function parseStatusEntry(line: string): GitStatusEntry {
  const index = line[0] ?? ' '
  const workingTree = line[1] ?? ' '
  const raw = line.slice(3)
  const renameSeparator = ' -> '
  if (raw.includes(renameSeparator)) {
    const [originalPath, path] = raw.split(renameSeparator)
    return {
      index,
      workingTree,
      path: path ?? raw,
      originalPath
    }
  }
  return { index, workingTree, path: raw }
}

function parseBranchLine(line: string): GitBranchSummary | null {
  const [refname, shortName, head, upstream, marker, updatedAt] = line.split('\t')
  if (!refname || !shortName || shortName.endsWith('/HEAD')) return null
  const kind = refname.startsWith('refs/remotes/') ? 'remote' : 'local'
  return {
    name: shortName,
    kind,
    current: marker === '*',
    head: head ?? '',
    ...(upstream ? { upstream } : {}),
    ...(updatedAt ? { updatedAt } : {})
  }
}

function diffArgs(scope: GitDiffScope, options: string[], path: string | undefined): string[] {
  return [
    '--literal-pathspecs',
    'diff',
    '--no-ext-diff',
    ...(scope === 'staged' ? ['--cached'] : []),
    ...(scope === 'all' ? ['HEAD'] : []),
    ...options,
    '--',
    ...(path ? [path] : [])
  ]
}

async function runGitText(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<GitTextResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      timeout: options.timeoutMs ?? 10_000,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      env: gitEnv(process.env)
    })
    return { stdout: String(stdout), stderr: String(stderr) }
  } catch (error) {
    throw gitServiceError(error)
  }
}

function runGitChunk(
  cwd: string,
  args: string[],
  options: { offset: number; maxBytes: number; timeoutMs: number }
): Promise<ProcessChunk> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      env: gitEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const chunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let seen = 0
    let collected = 0
    let truncated = false
    let killedForLimit = false
    const timer = setTimeout(() => {
      killedForLimit = true
      truncated = true
      child.kill('SIGTERM')
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return
      const start = Math.max(0, options.offset - seen)
      seen += chunk.length
      if (start >= chunk.length) return
      const available = chunk.subarray(start)
      const remaining = options.maxBytes + 1 - collected
      if (remaining <= 0) {
        truncated = true
        killedForLimit = true
        child.kill('SIGTERM')
        return
      }
      const selected = available.subarray(0, remaining)
      chunks.push(selected)
      collected += selected.length
      if (collected > options.maxBytes || available.length > remaining) {
        truncated = true
        killedForLimit = true
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.concat(stderrChunks).length < 32 * 1024) stderrChunks.push(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(gitServiceError(error))
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code !== 0 && !killedForLimit) {
        reject(gitServiceError(new Error(Buffer.concat(stderrChunks).toString('utf8') || `git exited with code ${code ?? signal ?? 'unknown'}`)))
        return
      }
      const buffer = Buffer.concat(chunks)
      const sliced = buffer.subarray(0, options.maxBytes)
      const bytesRead = sliced.length
      const nextOffset = truncated || buffer.length > options.maxBytes
        ? options.offset + bytesRead
        : undefined
      resolvePromise({
        text: sliced.toString('utf8'),
        offset: options.offset,
        bytesRead,
        truncated: nextOffset !== undefined,
        ...(nextOffset !== undefined ? { nextOffset, nextCursor: String(nextOffset) } : {})
      })
    })
  })
}

function gitEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    LANG: 'C'
  }
}

function gitServiceError(error: unknown): Error {
  const message = gitErrorText(error)
  if (/not a git repository/i.test(message)) {
    return serviceError('not_git_repo', 'The working directory is not a Git repository.', false, 'Choose a workspace inside a Git repository.')
  }
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) {
    return serviceError('git_unavailable', 'Git executable was not found.', false, 'Install Git and ensure it is available on PATH.')
  }
  return serviceError('git_error', message || 'Git command failed.', true, 'Check the repository state and retry.')
}

function gitErrorText(error: unknown): string {
  const details: string[] = []
  if (error instanceof Error) details.push(error.message)
  const stderr = isRecord(error) ? error.stderr : undefined
  if (typeof stderr === 'string') details.push(stderr)
  if (Buffer.isBuffer(stderr)) details.push(stderr.toString('utf8'))
  return details.join('\n').trim() || String(error)
}

async function readCheckpointMetadata(dataDir: string, checkpointId: string): Promise<CheckpointMetadata | null> {
  try {
    const metadata = await readCheckpointFile(dataDir, checkpointId, 'metadata.json')
    if (!metadata) return null
    const raw = JSON.parse(metadata) as unknown
    const record = asRecord(raw)
    const id = stringValue(record.checkpointId)
    const runtimeId = stringValue(record.runtimeId)
    const threadId = stringValue(record.threadId)
    const workspaceRoot = stringValue(record.workspaceRoot)
    const repositoryRoot = stringValue(record.repositoryRoot)
    const head = stringValue(record.head)
    const createdAt = stringValue(record.createdAt)
    const diffStat = stringValue(record.diffStat)
    const status = stringValue(record.status)
    if (!id || !isAgentRuntimeId(runtimeId) || !threadId || !workspaceRoot || !repositoryRoot || !head || !createdAt || !isCheckpointStatus(status)) {
      return null
    }
    return {
      checkpointId: id,
      runtimeId,
      threadId,
      ...(stringValue(record.turnId) ? { turnId: stringValue(record.turnId) } : {}),
      workspaceRoot,
      repositoryRoot,
      branch: typeof record.branch === 'string' ? record.branch : null,
      head,
      createdAt,
      diffStat,
      status,
      ...(stringValue(record.restoreStatus) ? { restoreStatus: stringValue(record.restoreStatus) } : {}),
      ...(stringValue(record.checkpointRef) ? { checkpointRef: stringValue(record.checkpointRef) } : {}),
      untrackedFiles: arrayOfStrings(record.untrackedFiles)
    }
  } catch {
    return null
  }
}

function publicCheckpoint(metadata: CheckpointMetadata): GitCheckpointSummary {
  return {
    checkpointId: metadata.checkpointId,
    runtimeId: metadata.runtimeId,
    threadId: metadata.threadId,
    ...(metadata.turnId ? { turnId: metadata.turnId } : {}),
    workspaceRoot: metadata.workspaceRoot,
    repositoryRoot: metadata.repositoryRoot,
    branch: metadata.branch,
    head: metadata.head,
    createdAt: metadata.createdAt,
    diffStat: metadata.diffStat,
    status: metadata.status,
    ...(metadata.restoreStatus ? { restoreStatus: metadata.restoreStatus } : {}),
    resourceUri: gitCheckpointResourceUri(metadata.checkpointId)
  }
}

function checkpointDir(dataDir: string, checkpointId: string): string {
  return join(resolve(dataDir), 'git-checkpoints', checkpointId)
}

async function readCheckpointFile(dataDir: string, checkpointId: string, fileName: string): Promise<string | null> {
  const path = await safeCheckpointFilePath(dataDir, checkpointId, fileName)
  if (!path) return null
  const file = await open(path, readOnlyNoFollowFlags()).catch(() => null)
  if (!file) return null
  try {
    return await file.readFile('utf8')
  } finally {
    await file.close()
  }
}

async function safeCheckpointFilePath(dataDir: string, checkpointId: string, fileName: string): Promise<string | null> {
  if (fileName.includes('/') || fileName.includes('\\')) return null
  const checkpointRoot = resolve(dataDir, 'git-checkpoints')
  const dir = checkpointDir(dataDir, checkpointId)
  const path = join(dir, fileName)
  const [rootReal, dirInfo, fileInfo] = await Promise.all([
    realpath(checkpointRoot).catch(() => null),
    lstat(dir).catch(() => null),
    lstat(path).catch(() => null)
  ])
  if (!rootReal || !dirInfo?.isDirectory() || !fileInfo?.isFile()) return null
  const [dirReal, fileReal] = await Promise.all([
    realpath(dir).catch(() => null),
    realpath(path).catch(() => null)
  ])
  if (!dirReal || !fileReal) return null
  if (!isPathWithin(rootReal, dirReal) || !isPathWithin(dirReal, fileReal)) return null
  return path
}

function isPathWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function safeCheckpointId(raw: string): string {
  const value = raw.trim()
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(value)) {
    throw serviceError('invalid_request', 'Invalid git checkpoint id.', false, 'Use checkpoint ids returned by gui_git_checkpoint_list.')
  }
  return value
}

async function readCheckpointTextFileChunk(
  dataDir: string,
  checkpointId: string,
  fileName: string,
  offset: number,
  maxBytes: number
): Promise<ProcessChunk> {
  const path = await safeCheckpointFilePath(dataDir, checkpointId, fileName)
  if (!path) return emptyTextFileChunk(offset)
  return readTextFileChunk(path, offset, maxBytes)
}

async function readTextFileChunk(path: string, offset: number, maxBytes: number): Promise<ProcessChunk> {
  const fileInfo = await lstat(path).catch(() => null)
  if (!fileInfo?.isFile() || fileInfo.size === 0) return emptyTextFileChunk(offset)
  const file = await open(path, readOnlyNoFollowFlags()).catch(() => null)
  if (!file) return emptyTextFileChunk(offset)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size === 0) return emptyTextFileChunk(offset)
    const safeOffset = Math.min(offset, info.size)
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, Math.max(0, info.size - safeOffset)))
    const result = await file.read(buffer, 0, buffer.length, safeOffset)
    const truncated = safeOffset + result.bytesRead < info.size || result.bytesRead > maxBytes
    const sliced = buffer.subarray(0, Math.min(result.bytesRead, maxBytes))
    const nextOffset = truncated ? safeOffset + sliced.length : undefined
    return {
      text: sliced.toString('utf8'),
      offset: safeOffset,
      bytesRead: sliced.length,
      truncated,
      ...(nextOffset !== undefined ? { nextOffset, nextCursor: String(nextOffset) } : {})
    }
  } finally {
    await file.close()
  }
}

function emptyTextFileChunk(offset: number): ProcessChunk {
  return { text: '', offset, bytesRead: 0, truncated: false }
}

function readOnlyNoFollowFlags(): number {
  return constants.O_RDONLY | constants.O_NOFOLLOW
}

function endpointSummary(id: 'model-router' | 'local-runtime', label: string, baseUrl: string): {
  id: 'model-router' | 'local-runtime'
  label: string
  endpoint: RuntimeEndpoint
} {
  return { id, label, endpoint: parseEndpoint(baseUrl) }
}

function parseEndpoint(baseUrl: string): RuntimeEndpoint {
  try {
    const url = new URL(baseUrl)
    const port = url.port
      ? Number.parseInt(url.port, 10)
      : url.protocol === 'https:'
        ? 443
        : url.protocol === 'http:'
          ? 80
          : null
    return {
      baseUrl: trimTrailingSlash(baseUrl),
      url,
      port: Number.isFinite(port) ? port : null,
      host: url.hostname,
      local: isLocalHost(url.hostname)
    }
  } catch {
    return {
      baseUrl,
      url: null,
      port: null,
      host: '',
      local: false
    }
  }
}

function checkTcpPort(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolvePromise({ ok: false, reason: 'connection_timeout' })
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolvePromise({ ok: true })
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ ok: false, reason: error.message })
    })
  })
}

async function fetchEndpoint(
  fetchImpl: RuntimeInspectorFetch,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs: number }
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.headers ?? {})
      },
      signal: controller.signal
    })
    return {
      ok: response.ok,
      status: response.status,
      text: await safeResponseText(response)
    }
  } catch (error) {
    if (isAbortError(error)) return { ok: false, status: 0, text: 'request_timeout' }
    return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJsonEndpoint(
  fetchImpl: RuntimeInspectorFetch,
  url: string,
  options: { headers?: Record<string, string>; timeoutMs: number }
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetchEndpoint(fetchImpl, url, options)
  if (!response.text) return { ok: response.ok, status: response.status, body: null }
  try {
    return { ok: response.ok, status: response.status, body: JSON.parse(response.text) as unknown }
  } catch {
    return { ok: response.ok, status: response.status, body: { text: response.text.slice(0, 8_000) } }
  }
}

function modelRouterHealthFromResponse(response: { ok: boolean; status: number; text: string }): RuntimeEndpointStatus {
  if (response.ok) {
    return { status: 'healthy', reachable: true, statusCode: response.status, message: 'Model Router is healthy.' }
  }
  if (response.status === 401 || response.status === 403 || /provider-auth|provider_auth|unauthorized|forbidden/i.test(response.text)) {
    return {
      status: 'degraded',
      reachable: true,
      statusCode: response.status || undefined,
      message: 'Model Router is reachable but provider authentication appears blocked.'
    }
  }
  return {
    status: 'unavailable',
    reachable: false,
    statusCode: response.status || undefined,
    message: response.text === 'request_timeout' ? 'Model Router health request timed out.' : 'Model Router is unavailable.'
  }
}

function localRuntimeHealthFromResponse(response: { ok: boolean; status: number; text: string }): RuntimeEndpointStatus {
  if (response.ok && isLocalRuntimeHealthBody(response.text)) {
    return { status: 'healthy', reachable: true, statusCode: response.status, message: 'Local runtime health endpoint is healthy.' }
  }
  if (response.ok) {
    return { status: 'degraded', reachable: true, statusCode: response.status, message: 'Local runtime health endpoint responded with an unexpected body.' }
  }
  return {
    status: 'unavailable',
    reachable: false,
    statusCode: response.status || undefined,
    message: response.text === 'request_timeout' ? 'Local runtime health request timed out.' : 'Local runtime health endpoint is unavailable.'
  }
}

function isLocalRuntimeHealthBody(text: string): boolean {
  try {
    const record = asRecord(JSON.parse(text) as unknown)
    return record.status === 'ok' && record.service === 'kun' && record.mode === 'serve'
  } catch {
    return false
  }
}

function modelRouterManagementUrl(baseUrl: URL, path: string): string {
  const trimmed = trimTrailingSlash(baseUrl.toString())
  const managementBase = trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed
  return `${managementBase}${path.startsWith('/') ? path : `/${path}`}`
}

async function gitDependency(): Promise<RuntimeDependency> {
  try {
    const result = await execFileAsync('git', ['--version'], {
      timeout: 3_000,
      maxBuffer: 64 * 1024,
      env: gitEnv(process.env)
    })
    return {
      id: 'git',
      available: true,
      version: String(result.stdout).trim()
    }
  } catch (error) {
    return {
      id: 'git',
      available: false,
      reason: gitErrorText(error) || 'Git executable was not found.'
    }
  }
}

function checkpointDependency(checkpointDataDir: string | undefined): RuntimeDependency {
  return checkpointDataDir
    ? {
        id: 'git-checkpoint-data-dir',
        available: true,
        path: resolve(expandHomePath(checkpointDataDir)),
        status: 'configured'
      }
    : {
        id: 'git-checkpoint-data-dir',
        available: false,
        reason: 'Checkpoint data dir was not configured.'
      }
}

function normalizeGitPath(pathInput: string | undefined, repositoryRoot: string): string | undefined {
  const raw = pathInput?.trim()
  if (!raw) return undefined
  const normalized = raw.replace(/\\/g, '/')
  const relativePath = isAbsolute(normalized)
    ? relative(repositoryRoot, normalized)
    : normalized
  const parts = relativePath.split(/[\\/]+/).filter(Boolean)
  if (
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    parts.some((part) => part === '..')
  ) {
    throw serviceError('path_outside_repository', 'Git diff path must stay inside the repository.', false, 'Pass a repository-relative path from git status or omit path.')
  }
  return parts.join('/')
}

async function resolveExistingPath(path: string): Promise<string> {
  const absolute = resolve(expandHomePath(path))
  try {
    return await realpath(absolute)
  } catch {
    throw serviceError('workspace_root_not_found', `Path does not exist: ${path}`, false, 'Choose an existing workspace directory.')
  }
}

function runtimeLifecycleBoundary(): Extract<RuntimeLocalStatusResult, { ok: true }>['lifecycleBoundary'] {
  return {
    processControl: 'not_exposed',
    managedProcessState: 'not_available_from_worker'
  }
}

function runtimeInspectorWorkerHealth(
  recentError: string | null
): Extract<RuntimeInspectorDiagnosticsResult, { ok: true }>['health'] {
  if (recentError) {
    return {
      status: 'degraded',
      available: true,
      reason: recentError
    }
  }
  return {
    status: 'healthy',
    available: true
  }
}

function invalidRequest(reason: string): RuntimeInspectorFailure {
  return {
    ok: false,
    error: {
      code: 'invalid_request',
      reason,
      retryable: false,
      suggestion: 'Fix the tool arguments to match the published schema.'
    }
  }
}

function serviceError(
  code: RuntimeInspectorErrorCode,
  reason: string,
  retryable: boolean,
  suggestion: string,
  details?: unknown
): Error {
  return Object.assign(new Error(reason), {
    runtimeInspectorError: true,
    code,
    retryable,
    suggestion,
    details
  })
}

function failureFromUnknown(error: unknown): RuntimeInspectorFailure {
  if (isServiceError(error)) {
    return {
      ok: false,
      error: {
        code: error.code,
        reason: error.message,
        retryable: error.retryable,
        suggestion: error.suggestion,
        ...(error.details !== undefined ? { details: error.details } : {})
      }
    }
  }
  if (isAbortError(error)) {
    return {
      ok: false,
      error: {
        code: 'aborted',
        reason: 'Runtime inspector request was aborted.',
        retryable: true,
        suggestion: 'Retry the request if it is still needed.'
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'unknown',
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
      suggestion: 'Check worker logs and retry.'
    }
  }
}

function recentErrorText(failure: RuntimeInspectorFailure): string {
  return `${failure.error.code}: ${failure.error.reason}`.slice(0, 1_000)
}

function isServiceError(error: unknown): error is Error & {
  runtimeInspectorError: true
  code: RuntimeInspectorErrorCode
  retryable: boolean
  suggestion: string
  details?: unknown
} {
  return isRecord(error) && error.runtimeInspectorError === true
}

function limitFor(value: number | undefined): number {
  return clampInteger(value ?? RUNTIME_INSPECTOR_DEFAULT_LIMIT, 1, RUNTIME_INSPECTOR_MAX_LIMIT)
}

function decodeCursor(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 20_000_000) : 0
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function cleanOptionalPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2).replace(/\\/g, '/'))
  }
  return path
}

function normalizeComparablePath(path: string): string {
  return resolve(expandHomePath(path)).split(sep).join('/').replace(/\/+$/, '')
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function isLocalHost(host: string): boolean {
  const value = host.toLowerCase()
  return value === 'localhost' || value === '127.0.0.1' || value === '::1'
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 16_000)
  } catch {
    return ''
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function redactSecrets(value: unknown): Record<string, unknown> {
  return redactValue(value) as Record<string, unknown>
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (!isRecord(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = /secret|token|api[_-]?key|password|authorization/i.test(key)
      ? '[redacted]'
      : redactValue(entry)
  }
  return output
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function isAgentRuntimeId(value: string): value is CheckpointMetadata['runtimeId'] {
  return value === 'sciforge' || value === 'codex' || value === 'claude'
}

function isCheckpointStatus(value: string): value is CheckpointMetadata['status'] {
  return value === 'available' || value === 'restored' || value === 'blocked' || value === 'failed'
}
