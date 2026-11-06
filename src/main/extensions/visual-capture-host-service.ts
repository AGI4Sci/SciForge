import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import type { HostServiceClientFactory, HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import { domainMainVisualCaptureResultSchema, VISUAL_CAPTURE_MAX_PNG_BYTES, type DomainMainVisualCaptureHost } from '@sciforge/domain-sdk/visual-capture'
import type { VisibleContextService } from '../services/visible-context-service'
import type { VisibleContextResource, VisibleContextSnapshot } from '../../shared/visible-context'
import { canonicalWorkspacePath, isWithinWorkspaceRoot, type WorkspaceAuthority } from './workspace-authority'

export const VISUAL_CAPTURE_HOST_SERVICE_ID = 'visualCapture' as const
export const VISUAL_CAPTURE_READ_PORT = 'visual-capture.read' as const
export const VISUAL_CAPTURE_CAPTURE_PORT = 'visual-capture.capture' as const

type Identity = Readonly<{ packageName: string; version: string; generation: number }>
export type VisualCaptureHostServiceOptions = Readonly<{
  visibleContext: Pick<VisibleContextService, 'boundSurface' | 'registeredTargetRef' | 'resolveRegisteredTarget' | 'currentRegisteredTargetSnapshot'>
  visualCapture: DomainMainVisualCaptureHost
  authorizeWorkspace: WorkspaceAuthority
  readGrantedPorts: (identity: Identity) => readonly string[] | undefined
  hostServiceClientModule: string
  instanceId: string
}>
export type VisualCaptureHostServiceResolver = Readonly<{
  resolve(packageName: string, version: string, generation: number): Readonly<Record<string, HostServiceProvider>> | undefined
  resolveClients(packageName: string, version: string, generation: number): readonly HostServiceClientFactory[]
  serviceIds: readonly string[]
}>

const captureInput = z.object({
  targetRef: z.string().trim().min(1).max(512),
  expectedResourcePath: z.string().trim().min(1).max(4096),
  annotation: z.enum(['none', 'callout']).optional(),
  label: z.string().trim().min(1).max(500).optional()
}).strict()
const listInput = z.object({}).strict()
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function resourcePath(resource: VisibleContextResource, root: string): string | undefined {
  if (resource.workspaceRoot && canonicalWorkspacePath(resource.workspaceRoot) !== root) return undefined
  const paths = [resource.path, resource.relativePath].filter((path): path is string => typeof path === 'string' && path.length > 0)
  if (!paths.length) return undefined
  const canonical = paths.map(path => canonicalWorkspacePath(isAbsolute(path) ? path : resolve(root, path)))
  const path = canonical[0]
  return path && canonical.every(value => value === path) && isWithinWorkspaceRoot(path, root) && path !== root ? path : undefined
}

function provider(options: VisualCaptureHostServiceOptions, identity: Identity): HostServiceProvider {
  const live = (request: HostServiceRequest) => {
    if (!request.assertCurrent) throw new Error('Visual capture requires a live Host authority lease.')
    request.assertCurrent()
    request.signal.throwIfAborted()
    const port = request.operation === 'listTargets' ? VISUAL_CAPTURE_READ_PORT : VISUAL_CAPTURE_CAPTURE_PORT
    if (request.serviceId !== VISUAL_CAPTURE_HOST_SERVICE_ID || !['listTargets', 'captureRegisteredTarget'].includes(request.operation) ||
        request.owner.packageName !== identity.packageName || request.owner.version !== identity.version || request.owner.generation !== identity.generation ||
        !options.readGrantedPorts(identity)?.includes(port)) throw new Error('Visual capture owner or operation is not authorized.')
  }
  const authorize = async (request: HostServiceRequest) => {
    live(request)
    if (request.operation === 'listTargets') listInput.parse(request.input)
    else captureInput.parse(request.input)
    const caller = record(request.owner.authority.caller)
    const session = record(request.owner.authority.ordinarySession)
    if (caller.audience !== 'agent' || typeof caller.callerId !== 'string' || !caller.callerId.trim() ||
        typeof session.runtimeId !== 'string' || !session.runtimeId.trim() || typeof session.threadId !== 'string' || !session.threadId.trim()) {
      throw new Error('Visual capture requires an authenticated agent and ordinary Session.')
    }
    const workspaceId = typeof caller.workspaceId === 'string' ? caller.workspaceId : ''
    const root = canonicalWorkspacePath(workspaceId)
    if (!root || !await options.authorizeWorkspace({ caller, workspaceId })) throw new Error('Visual capture workspace is not authorized.')
    live(request)
    const snapshot = options.visibleContext.boundSurface(caller.callerId)
    if (!snapshot || snapshot.activeThreadId !== session.threadId ||
        !snapshot.workspaceRoot || canonicalWorkspacePath(snapshot.workspaceRoot) !== root) throw new Error('Visual capture has no current bound task view.')
    return { root, callerId: caller.callerId, threadId: session.threadId, snapshot: structuredClone(snapshot) }
  }
  type Scope = Awaited<ReturnType<typeof authorize>>
  const sameSurface = (scope: Scope) => {
    const current = options.visibleContext.boundSurface(scope.callerId)
    if (!current || current.windowId !== scope.snapshot.windowId || current.revision !== scope.snapshot.revision ||
        current.activeThreadId !== scope.threadId || !current.workspaceRoot || canonicalWorkspacePath(current.workspaceRoot) !== scope.root) {
      throw new Error('Visual capture bound task view changed.')
    }
  }
  const matchesTarget = (scope: Scope, snapshot: VisibleContextSnapshot, componentId: string, targetId: string, path: string): boolean => {
    if (snapshot.freshness.stale || snapshot.windowId !== scope.snapshot.windowId || snapshot.activeThreadId !== scope.threadId ||
        !snapshot.workspaceRoot || canonicalWorkspacePath(snapshot.workspaceRoot) !== scope.root) return false
    const component = snapshot.components.find(item => item.id === componentId && item.visible)
    const target = component?.visualTargets?.find(item => item.id === targetId)
    const paths = component?.resources?.map(resource => resourcePath(resource, scope.root)) ?? []
    return Boolean(target && target.kind !== 'window' && !target.redact && target.active !== false && target.bounds &&
      paths.length && paths.every(candidate => candidate === path))
  }
  const targets = async (scope: Scope, request: HostServiceRequest) => {
    const result: Array<{ targetRef: string; resourcePath: string; label: string }> = []
    for (const component of scope.snapshot.components) {
      if (!component.visible) continue
      // A component with ambiguous or foreign resources cannot grant a target.
      const resources = component.resources ?? []
      const paths = resources.map(resource => resourcePath(resource, scope.root))
      if (!paths.length || paths.some(path => !path) || new Set(paths).size !== 1) continue
      for (const target of component.visualTargets ?? []) {
        if (target.redact || target.kind === 'window' || target.active === false || !target.bounds) continue
        live(request)
        const targetRef = await options.visibleContext.registeredTargetRef(scope.snapshot.windowId, { componentId: component.id, targetId: target.id })
        if (targetRef) {
          const current = await options.visibleContext.currentRegisteredTargetSnapshot(targetRef)
          live(request)
          if (current && matchesTarget(scope, current, component.id, target.id, paths[0]!)) {
            result.push({ targetRef, resourcePath: paths[0]!, label: component.title ?? component.summary ?? component.id })
          }
        }
      }
    }
    sameSurface(scope)
    live(request)
    return result
  }
  const checkRegistry = async (scope: Scope, targetRef: string, path: string, request: HostServiceRequest) => {
    const current = await options.visibleContext.currentRegisteredTargetSnapshot(targetRef)
    live(request)
    sameSurface(scope)
    if (current) {
      for (const component of scope.snapshot.components) {
        for (const target of component.visualTargets ?? []) {
          if (await options.visibleContext.registeredTargetRef(scope.snapshot.windowId, { componentId: component.id, targetId: target.id }) === targetRef &&
              matchesTarget(scope, { ...scope.snapshot, freshness: { ...scope.snapshot.freshness, stale: false } }, component.id, target.id, path) && matchesTarget(scope, current, component.id, target.id, path)) {
            live(request)
            return current.revision
          }
        }
      }
    }
    throw new Error('Visual capture registry target changed resource, thread, window or redaction.')
  }
  return {
    authorize: async request => { await authorize(request) },
    operations: {
      listTargets: async request => {
        const scope = await authorize(request)
        return { targets: await targets(scope, request) }
      },
      captureRegisteredTarget: async request => {
        const scope = await authorize(request)
        const input = captureInput.parse(request.input)
        const target = (await targets(scope, request)).find(candidate => candidate.targetRef === input.targetRef)
        // expectedResourcePath is a selector checked against registry-owned data.
        if (!target || resourcePath({ kind: 'selector', path: input.expectedResourcePath }, scope.root) !== target.resourcePath) {
          throw new Error('Visual capture target does not match the registered task resource.')
        }
        const validatedRevision = await checkRegistry(scope, target.targetRef, target.resourcePath, request)
        const captured = domainMainVisualCaptureResultSchema.parse(await options.visualCapture.captureRegisteredTarget({
          targetRef: target.targetRef, annotation: input.annotation, label: input.label
        }))
        live(request)
        await checkRegistry(scope, target.targetRef, target.resourcePath, request)
        if (!captured.ok) return captured
        const bytes = Buffer.from(captured.png)
        if (bytes.byteLength < 24 || bytes.byteLength > VISUAL_CAPTURE_MAX_PNG_BYTES ||
            !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== captured.width || bytes.readUInt32BE(20) !== captured.height ||
            createHash('sha256').update(bytes).digest('hex') !== captured.sha256) throw new Error('Visual capture returned invalid PNG bytes, dimensions or digest.')
        live(request)
        return {
          ok: true, pngBase64: bytes.toString('base64'), width: captured.width, height: captured.height,
          sha256: captured.sha256, byteLength: bytes.byteLength, redacted: captured.redacted,
          source: { instanceId: options.instanceId, workspaceRoot: scope.root, threadId: scope.threadId,
            windowId: scope.snapshot.windowId, targetRef: target.targetRef, resourcePath: target.resourcePath,
            validatedRevision, captureRevisionAtomic: false as const, capturedAt: new Date().toISOString(), redactionPolicy: 'registered-target-v1' }
        }
      }
    }
  }
}

export function createVisualCaptureHostServiceResolver(options: VisualCaptureHostServiceOptions): VisualCaptureHostServiceResolver {
  const modulePath = options.hostServiceClientModule
  if (!isAbsolute(modulePath) || !options.instanceId.trim()) throw new TypeError('Visual capture requires an absolute Host client module and instance id.')
  const admitted = (identity: Identity) => options.readGrantedPorts(identity)?.some(port => port === VISUAL_CAPTURE_READ_PORT || port === VISUAL_CAPTURE_CAPTURE_PORT) === true
  return {
    resolve(packageName, version, generation) {
      const identity = { packageName, version, generation }
      return admitted(identity) ? { [VISUAL_CAPTURE_HOST_SERVICE_ID]: provider(options, identity) } : undefined
    },
    resolveClients(packageName, version, generation) {
      return admitted({ packageName, version, generation }) ? [{ serviceId: VISUAL_CAPTURE_HOST_SERVICE_ID, modulePath,
        exportName: 'createHostServiceClient', config: { serviceId: VISUAL_CAPTURE_HOST_SERVICE_ID } }] : []
    },
    serviceIds: [VISUAL_CAPTURE_HOST_SERVICE_ID]
  }
}
