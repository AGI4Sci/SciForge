import { appendFileSync } from 'node:fs'
import type { HostServiceProvider, HostServiceRequest, HostServiceClientFactory } from '@sciforge/plugin-sdk'
import { PythonEvidenceWorker, type PythonWorkerOptions } from './python-worker.js'
import { EVIDENCE_PORTS_SERVICE_ID } from './host-provider.js'
import type { Scope, Identity, Json, ThreadProjection, PortRequest } from './ports.js'
import { readCommittedChain, readCommittedSnapshot, committedStatus } from './committed-reader.js'

export type EvidenceCallContext = Readonly<{
  caller: Readonly<Record<string, unknown>>
  ordinarySession?: Readonly<Record<string, unknown>>
  originalContext?: Readonly<Record<string, unknown>>
  signal: AbortSignal
  assertCurrent(): void
}>
export type EvidenceProductionOptions = Readonly<{
  identity: Identity
  storageRoot: string
  storageInterpreter?: string
  clientModule: string
  worker: PythonWorkerOptions
  threads: {
    read(scope: Scope, context: EvidenceCallContext): Promise<ThreadProjection>
    list(scope: Scope, context: EvidenceCallContext): Promise<readonly Scope[]>
  }
  artifacts: {
    invoke(operation: 'artifacts.commit' | 'artifacts.read' | 'artifacts.listEvents', scope: Scope, input: Json, context: EvidenceCallContext): Promise<unknown>
  }
}>
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Evidence requires Host-bound invocation facts.')
  return value as Record<string, any>
}
/** Package-owned production owner: no static runtime and no unimplemented execute callback.
 * Canonical thread/artifact ports retain the real caller and live lease; Python stays in Host.
 */
export function createEvidenceProductionService(options: EvidenceProductionOptions) {
  const worker = new PythonEvidenceWorker(options.worker)
  let closed = false
  const readerAbort = new AbortController()
  const readerTasks = new Set<Promise<unknown>>()
  const close = async (diagnostic?: { operation: string; generation: number; invocationId: string }) => {
    if (!closed && process.env.SCIFORGE_DIAGNOSTIC_HANDLER_CAUSE === '1') {
      const line = JSON.stringify({ event: 'SCIFORGE_FIRST_OWNER_CLOSE', pid: process.pid, ...diagnostic, stack: new Error('first owner close').stack })
      console.error(line)
      if (process.env.SCIFORGE_CLOSE_TRACE_FILE) appendFileSync(process.env.SCIFORGE_CLOSE_TRACE_FILE, line + '\n')
    }
    closed = true
    readerAbort.abort()
    await Promise.allSettled([...readerTasks])
    try { await worker.close() } catch {
      // A bounded worker deadline is not a service cancellation acknowledgement.
      // Keep ownership, join the actual producers, then retry the bounded close.
      await worker.waitForQuiescence()
      await worker.close()
    }
  }
  const payloadFor = (request: HostServiceRequest): PortRequest => {
    const payload = record(request.input)
    if (request.owner.pluginId !== options.identity.pluginId || request.owner.version !== options.identity.version ||
      payload.identity?.pluginId !== options.identity.pluginId || payload.identity?.version !== options.identity.version || payload.identity?.profileId !== options.identity.profileId ||
      payload.protocol !== 'sciforge-evidence-ports.v1' || payload.operation !== request.operation) throw new Error('Evidence identity or protocol mismatch.')
    return payload as PortRequest
  }
  const bind = (request: HostServiceRequest) => {
    const payload = payloadFor(request)
    if (!request.assertCurrent) throw new Error('Evidence requires the live Host principal lease.')
    const authority = request.owner.authority
    const caller = record(authority.caller), session = record(authority.ordinarySession)
    if (typeof caller.workspaceId !== 'string' || typeof session.runtimeId !== 'string' || typeof session.threadId !== 'string') throw new Error('Evidence requires canonical ordinary Session and workspace.')
    const scope = { runtimeId: session.runtimeId, threadId: session.threadId, workspaceRoot: caller.workspaceId }
    if (!payload.scope || Object.entries(scope).some(([key, value]) => payload.scope![key as keyof Scope] !== value)) throw new Error('Evidence scope does not match canonical ordinary Session.')
    const context: EvidenceCallContext = { caller, ordinarySession: session, ...(authority.originalContext ? { originalContext: record(authority.originalContext) } : {}), signal: request.signal,
      assertCurrent() { if (closed) throw new Error('Evidence production owner is closed.'); request.signal.throwIfAborted(); request.assertCurrent!() } }
    context.assertCurrent()
    return { payload, scope, context }
  }
  const bindCommitted = (request: HostServiceRequest) => {
    const payload = payloadFor(request)
    if (!request.assertCurrent) throw new Error('Evidence requires the live Host principal lease.')
    const caller = record(request.owner.authority.caller)
    const scope = payload.scope
    if (!scope || ['runtimeId', 'threadId', 'workspaceRoot'].some(key => typeof scope[key as keyof Scope] !== 'string' || scope[key as keyof Scope].length === 0) || caller.workspaceId !== scope.workspaceRoot) throw new Error('Evidence committed scope requires exact Host workspace authority.')
    const context: EvidenceCallContext = { caller, signal: AbortSignal.any([request.signal, readerAbort.signal]), assertCurrent() {
      if (closed) throw new Error('Evidence production owner is closed.')
      request.signal.throwIfAborted(); request.assertCurrent!()
    } }
    context.assertCurrent()
    return { scope, context }
  }
  const operationEffects: Readonly<Record<string, 'read' | 'workspace-write'>> = {
    'committed.status': 'read',
    'threads.read': 'read', 'threads.list': 'read', 'artifacts.read': 'read', 'artifacts.listEvents': 'read',
    'artifacts.commit': 'workspace-write', 'sidecar.extract': 'workspace-write', 'sidecar.commitSnapshot': 'workspace-write',
    'sidecar.readSnapshot': 'read', 'sidecar.snapshotProducts': 'read'
  }
  const operations = ['threads.read', 'threads.list', 'artifacts.commit', 'artifacts.read', 'artifacts.listEvents', 'sidecar.extract', 'sidecar.commitSnapshot', 'sidecar.readSnapshot', 'sidecar.snapshotProducts', 'sidecar.close'] as const
  const authorizeEffect = (request: HostServiceRequest): void => {
    const effect = request.owner.authority.effect
    const required = Object.hasOwn(operationEffects, request.operation) ? operationEffects[request.operation] : undefined
    if (required === undefined || !(effect === 'workspace-write' || (effect === 'read' && required === 'read'))) {
      throw new Error(`Evidence operation ${request.operation} is not authorized by capability effect ${String(effect)}.`)
    }
  }
  const provider: HostServiceProvider = {
    async dispose(owner) {
      if (owner.pluginId !== options.identity.pluginId || owner.version !== options.identity.version) return
      await close({ operation: 'dispose', generation: owner.generation, invocationId: owner.invocationId })
    },
    authorize(request) {
      if (request.operation !== 'sidecar.close') authorizeEffect(request)
      if (request.operation === 'sidecar.close') {
        payloadFor(request)
        if (request.owner.authority.lifecycle !== 'deactivate') throw new Error('Producer shutdown requires Host lifecycle authority.')
      } else if (request.operation === 'committed.status') bindCommitted(request)
      else bind(request)
    },
    operations: { 'committed.status': async (request: HostServiceRequest) => {
      provider.authorize(request)
      const task = (async () => {
        const { scope, context } = bindCommitted(request)
        const projection = await options.threads.read(scope, context)
        context.assertCurrent()
        if (Object.entries(scope).some(([key, value]) => projection[key as keyof Scope] !== value)) throw new Error('Evidence canonical scope mismatch.')
        if (!options.storageInterpreter) throw new Error('Trusted storageInterpreter is required for committed reads.')
        const chain = await readCommittedChain(options.storageRoot, options.storageInterpreter, scope, context.signal, options.worker.wheelPath)
        const result = await committedStatus(chain, scope, async digest => {
          context.assertCurrent()
          return readCommittedSnapshot(options.worker, options.storageInterpreter, `${scope.runtimeId}:${scope.threadId}`, digest, context.signal)
        })
        context.assertCurrent()
        return result
      })()
      readerTasks.add(task)
      try { return await task } finally { readerTasks.delete(task) }
    }, ...Object.fromEntries(operations.map(operation => [operation, async (request: HostServiceRequest) => {
      provider.authorize(request)
      if (operation === 'sidecar.close') { await close({ operation, generation: request.owner.generation, invocationId: request.owner.invocationId }); return { exited: true } }
      const { payload, scope, context } = bind(request)
      // Invocation leases also own thread/artifact callbacks. Cancelling those
      // must join that callback, not terminate the generation's Python runtime.
      // A serial worker command cannot be interrupted independently, so only
      // its cancellation fences/closes this producer generation.
      const ownsWorkerCommand = operation.startsWith('sidecar.')
      const abort = () => { if (ownsWorkerCommand) void close({ operation: `abort:${operation}`, generation: request.owner.generation, invocationId: request.owner.invocationId }).catch(() => undefined) }
      request.signal.addEventListener('abort', abort, { once: true })
      try {
        let result: unknown
        if (operation === 'threads.read') {
          const projection = await options.threads.read(scope, context)
          if (Object.entries(scope).some(([key, value]) => projection[key as keyof Scope] !== value)) throw new Error('Canonical thread projection scope mismatch.')
          result = projection
        } else if (operation === 'threads.list') {
          result = (await options.threads.list(scope, context)).filter(candidate => Object.entries(scope).every(([key, value]) => candidate[key as keyof Scope] === value))
        } else if (operation.startsWith('artifacts.')) {
          result = await options.artifacts.invoke(operation as 'artifacts.commit' | 'artifacts.read' | 'artifacts.listEvents', scope, payload.input, context)
        } else {
          const input = record(payload.input)
          if (input.threadId !== `${scope.runtimeId}:${scope.threadId}` || input.workspaceRoot !== scope.workspaceRoot) throw new Error('Evidence worker scope mismatch.')
          result = await worker.request(operation.slice('sidecar.'.length) as 'extract' | 'commitSnapshot' | 'readSnapshot' | 'snapshotProducts', payload.input, context)
        }
        context.assertCurrent()
        return result
      } finally {
        request.signal.removeEventListener('abort', abort)
        if (request.signal.aborted && ownsWorkerCommand) await worker.waitForQuiescence()
      }
    }])) }
  }
  const clients: readonly HostServiceClientFactory[] = [{ serviceId: EVIDENCE_PORTS_SERVICE_ID, modulePath: options.clientModule, exportName: 'createEvidencePortsService', config: { identity: options.identity, storageRoot: options.storageRoot } }]
  return { providers: { [EVIDENCE_PORTS_SERVICE_ID]: provider }, clients, worker, close }
}
