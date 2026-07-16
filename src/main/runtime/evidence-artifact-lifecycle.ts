import { watch, type FSWatcher } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentRuntimeThread, AgentRuntimeThreadListInput } from '../../shared/agent-runtime-contract'
import {
  evidenceDagApiKeyFromEnv,
  evidenceDagServiceUrlFromEnv,
  evidenceDagThreadId
} from '../../../packages/workers/evidence-dag/desktop/contract'
import { enqueueEvidenceDagUpdate, type EnqueueEvidenceDagUpdateInput } from './evidence-dag-feed'

export type ArtifactLifecycleEvent = {
  eventId: string
  type: 'ArtifactMoved' | 'ArtifactContentChanged'
  artifactId: string
  outcome: string
}

export type ArtifactLifecycleScan = {
  events: ArtifactLifecycleEvent[]
  affectedThreads: Array<{
    threadId: string
    targetWatermark: string
    artifactIds: string[]
  }>
  scope: {
    projectKey: string
    workspaceRoot: string
    projectRoot: string
  }
}

type ThreadSource = {
  listThreads(input?: AgentRuntimeThreadListInput): Promise<AgentRuntimeThread[]>
}

type WatchFactory = (
  path: string,
  options: { recursive: boolean },
  listener: () => void
) => FSWatcher

export type EvidenceArtifactLifecycleOptions = {
  threads: ThreadSource
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  ensureEvidenceDagReady?: () => Promise<void>
  enqueue?: (input: EnqueueEvidenceDagUpdateInput) => Promise<unknown>
  watchFactory?: WatchFactory
  discoveryIntervalMs?: number
  quietMs?: number
  log?: (message: string, details?: Record<string, unknown>) => void
}

type WorkspaceState = {
  path: string
  threads: AgentRuntimeThread[]
  watcher?: FSWatcher
  scanTimer?: ReturnType<typeof setTimeout>
  scan?: Promise<void>
}

const DEFAULT_DISCOVERY_INTERVAL_MS = 30_000
const DEFAULT_QUIET_MS = 1_000

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function scanPayload(value: unknown): ArtifactLifecycleScan {
  const envelope = objectRecord(value)
  if (envelope?.ok !== true) {
    const error = objectRecord(envelope?.error)
    throw new Error(typeof error?.message === 'string' ? error.message : 'Artifact lifecycle scan failed.')
  }
  const data = objectRecord(envelope.data)
  const scope = objectRecord(data?.scope)
  if (!data || !scope || !Array.isArray(data.events) || !Array.isArray(data.affectedThreads)) {
    throw new Error('Artifact lifecycle scan returned an invalid response.')
  }
  return data as unknown as ArtifactLifecycleScan
}

function runtimeThreadFromEngineId(
  engineThreadId: string,
  threads: readonly AgentRuntimeThread[]
): AgentRuntimeThread | undefined {
  return threads.find((thread) => evidenceDagThreadId(thread.runtimeId, thread.id) === engineThreadId)
}

export class EvidenceArtifactLifecycle {
  private readonly workspaces = new Map<string, WorkspaceState>()
  private discoveryTimer: ReturnType<typeof setInterval> | undefined
  private stopped = true

  constructor(private readonly options: EvidenceArtifactLifecycleOptions) {}

  async start(): Promise<void> {
    if (!this.stopped) return
    this.stopped = false
    await this.refreshWorkspaces()
    const interval = positiveNumber(
      this.options.discoveryIntervalMs ?? this.options.env?.SCIFORGE_ARTIFACT_DISCOVERY_MS,
      DEFAULT_DISCOVERY_INTERVAL_MS
    )
    this.discoveryTimer = setInterval(() => {
      void this.refreshWorkspaces().catch((error) => this.report('Workspace discovery failed.', error))
    }, interval)
    this.discoveryTimer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.discoveryTimer) clearInterval(this.discoveryTimer)
    this.discoveryTimer = undefined
    for (const state of this.workspaces.values()) {
      if (state.scanTimer) clearTimeout(state.scanTimer)
      state.watcher?.close()
    }
    this.workspaces.clear()
  }

  async refreshWorkspaces(): Promise<void> {
    if (this.stopped) return
    const threads = await this.options.threads.listThreads({
      limit: 1_000,
      includeArchived: true,
      includeSide: true
    })
    if (this.stopped) return
    const grouped = new Map<string, AgentRuntimeThread[]>()
    for (const thread of threads) {
      const workspace = thread.workspace?.trim()
      if (!workspace) continue
      const key = resolve(workspace)
      grouped.set(key, [...(grouped.get(key) ?? []), thread])
    }
    for (const [path, state] of this.workspaces) {
      const current = grouped.get(path)
      if (current) {
        state.threads = current
        // A platform without recursive fs.watch support still receives a
        // bounded project-scope scan on the discovery cadence.
        if (!state.watcher) this.scheduleScan(path, 0)
        continue
      }
      if (state.scanTimer) clearTimeout(state.scanTimer)
      state.watcher?.close()
      this.workspaces.delete(path)
    }
    for (const [path, workspaceThreads] of grouped) {
      if (this.workspaces.has(path)) continue
      let watcher: FSWatcher | undefined
      try {
        watcher = (this.options.watchFactory ?? watch)(path, { recursive: true }, () => {
          this.scheduleScan(path)
        })
        watcher.on('error', (error) => this.report(`Artifact watcher failed for ${path}.`, error))
      } catch (error) {
        this.report(`Recursive Artifact watching is unavailable for ${path}; using scoped polling.`, error)
      }
      this.workspaces.set(path, { path, threads: workspaceThreads, watcher })
      this.scheduleScan(path, 0)
    }
  }

  async scanNow(workspaceRoot: string): Promise<void> {
    const state = this.workspaces.get(resolve(workspaceRoot))
    if (!state || this.stopped) return
    if (state.scan) return state.scan
    const operation = this.scanWorkspace(state).finally(() => {
      if (state.scan === operation) state.scan = undefined
    })
    state.scan = operation
    return operation
  }

  private scheduleScan(workspaceRoot: string, delay?: number): void {
    const state = this.workspaces.get(workspaceRoot)
    if (!state || this.stopped) return
    if (state.scanTimer) clearTimeout(state.scanTimer)
    const quietMs = delay ?? positiveNumber(
      this.options.quietMs ?? this.options.env?.SCIFORGE_ARTIFACT_WATCH_QUIET_MS,
      DEFAULT_QUIET_MS
    )
    state.scanTimer = setTimeout(() => {
      state.scanTimer = undefined
      void this.scanNow(workspaceRoot).catch((error) => this.report(
        `Artifact lifecycle scan failed for ${workspaceRoot}.`, error
      ))
    }, quietMs)
    state.scanTimer.unref?.()
  }

  private async scanWorkspace(state: WorkspaceState): Promise<void> {
    const scan = await this.requestScan(state.path)
    if (scan.events.length === 0) return
    const activeSessions = state.threads
      .filter((thread) => !thread.archived)
      .map((thread) => evidenceDagThreadId(thread.runtimeId, thread.id))
    const enqueue = this.options.enqueue ?? enqueueEvidenceDagUpdate
    await Promise.all(scan.affectedThreads.map(async (affected) => {
      const thread = runtimeThreadFromEngineId(affected.threadId, state.threads)
      if (!thread) {
        this.options.log?.('Artifact change references a runtime thread that is no longer available.', {
          workspaceRoot: state.path,
          threadId: affected.threadId
        })
        throw new Error(`Runtime thread ${affected.threadId} is unavailable for Artifact reingest.`)
      }
      await enqueue({
        runtimeId: thread.runtimeId,
        threadId: thread.id,
        items: [],
        targetWatermark: affected.targetWatermark,
        reason: 'artifact_changed',
        priority: 'background',
        ...(!thread.archived ? {
          projectContext: {
            projectKey: scan.scope.projectKey,
            workspaceRoot: scan.scope.workspaceRoot,
            projectRoot: scan.scope.projectRoot,
            includedSessions: activeSessions
          }
        } : {})
      })
    }))
    await this.acknowledgeEvents(scan)
  }

  private async requestScan(workspaceRoot: string): Promise<ArtifactLifecycleScan> {
    await this.options.ensureEvidenceDagReady?.()
    const env = this.options.env ?? process.env
    const serviceUrl = evidenceDagServiceUrlFromEnv(env)
    const apiKey = evidenceDagApiKeyFromEnv(env)
    if (!serviceUrl || !apiKey) throw new Error('Evidence DAG service is not configured.')
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch
    const response = await fetchImpl(`${serviceUrl}/artifacts/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        projectKey: workspaceRoot,
        workspaceRoot,
        projectRoot: workspaceRoot
      })
    })
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) {
      const message = objectRecord(objectRecord(payload)?.error)?.message
      throw new Error(typeof message === 'string' ? message : `Artifact lifecycle scan failed (${response.status}).`)
    }
    return scanPayload(payload)
  }

  private async acknowledgeEvents(scan: ArtifactLifecycleScan): Promise<void> {
    const env = this.options.env ?? process.env
    const serviceUrl = evidenceDagServiceUrlFromEnv(env)
    const apiKey = evidenceDagApiKeyFromEnv(env)
    if (!serviceUrl || !apiKey) throw new Error('Evidence DAG service is not configured.')
    const response = await (this.options.fetchImpl ?? globalThis.fetch)(
      `${serviceUrl}/artifacts/events/ack`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          projectKey: scan.scope.projectKey,
          workspaceRoot: scan.scope.workspaceRoot,
          projectRoot: scan.scope.projectRoot,
          eventIds: scan.events.map((event) => event.eventId)
        })
      }
    )
    const payload = await response.json().catch(() => undefined)
    if (!response.ok || objectRecord(payload)?.ok !== true) {
      const message = objectRecord(objectRecord(payload)?.error)?.message
      throw new Error(typeof message === 'string' ? message : 'Artifact event acknowledgement failed.')
    }
  }

  private report(message: string, error: unknown): void {
    this.options.log?.(message, {
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
