import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostServiceProviderRegistry, type HostServiceRequest } from '@sciforge/plugin-sdk'
import type { VisibleContextSnapshot } from '../../shared/visible-context'
import { createVisualCaptureHostServiceResolver } from './visual-capture-host-service'
import { canonicalWorkspacePath } from './workspace-authority'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'visual-capture-service-'))
  directories.push(root)
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const path = join(workspace, 'review.md')
  let current = true
  let granted = ['visual-capture.read', 'visual-capture.capture']
  let captures = 0
  let onCapture = () => {}
  const snapshot: VisibleContextSnapshot = {
    schemaVersion: 3, windowId: 'window-1', revision: 1, publishedAt: new Date().toISOString(),
    freshness: { stale: false, ageMs: 0, staleAfterMs: 5000 }, activeThreadId: 'thread-1', workspaceRoot: workspace,
    components: [{ id: 'document', region: 'main', component: 'editor', title: 'Review', visible: true,
      updatedAt: new Date().toISOString(), summary: 'Document', resources: [{ kind: 'file', path }],
      visualTargets: [{ id: 'page', kind: 'component', bounds: { x: 0, y: 0, width: 2, height: 2 } }] }]
  }
  const latest = structuredClone(snapshot)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=', 'base64')
  const resolver = createVisualCaptureHostServiceResolver({
    instanceId: 'instance-test', hostServiceClientModule: '/approved/host-service-client.mjs',
    authorizeWorkspace: async ({ workspaceId }) => workspaceId === workspace,
    readGrantedPorts: identity => identity.packageName === '@test/plugin' && identity.version === '1.0.0' && identity.generation === 1 ? granted : undefined,
    visibleContext: {
      boundSurface: callerId => callerId === 'caller' ? snapshot : null,
      registeredTargetRef: async () => 'opaque-target',
      currentRegisteredTargetSnapshot: async () => structuredClone(latest),
      resolveRegisteredTarget: async () => ({ surface: { windowId: snapshot.windowId, revision: snapshot.revision, activeThreadId: snapshot.activeThreadId ?? null },
        bounds: { x: 0, y: 0, width: 2, height: 2 }, sensitive: snapshot.components[0]!.visualTargets![0]!.redact === true, redactionBounds: [] })
    },
    visualCapture: { captureRegisteredTarget: async () => {
      captures++
      onCapture()
      return { ok: true, png, width: 2, height: 2, sha256: createHash('sha256').update(png).digest('hex'), redacted: true }
    } }
  })
  const registry = new HostServiceProviderRegistry(resolver.resolve('@test/plugin', '1.0.0', 1)!)
  const request: HostServiceRequest = {
    requestId: 'request', serviceId: 'visualCapture', operation: 'captureRegisteredTarget', input: { targetRef: 'opaque-target', expectedResourcePath: path },
    owner: { connectionId: 'connection', pluginId: 'plugin', packageName: '@test/plugin', version: '1.0.0', generation: 1, invocationId: 'invocation',
      authority: { caller: { audience: 'agent', callerId: 'caller', workspaceId: workspace }, ordinarySession: { runtimeId: 'dsh', threadId: 'thread-1' } } },
    signal: new AbortController().signal,
    assertCurrent: () => { if (!current) throw new Error('lease revoked') }
  }
  return { resolver, registry, request, snapshot, latest, workspace, root, path, captures: () => captures,
    revoke: () => { current = false }, revokePort: () => { granted = [] }, onCapture: (callback: () => void) => { onCapture = callback } }
}

describe('generic visual capture Host service', () => {
  it('projects exact-identity clients, lists a bound registered task, returns only JSON evidence', async () => {
    const f = await fixture()
    expect(f.resolver.resolveClients('@test/plugin', 'wrong', 1)).toEqual([])
    expect(f.resolver.resolveClients('@test/plugin', '1.0.0', 1)[0]).toMatchObject({ serviceId: 'visualCapture', exportName: 'createHostServiceClient' })
    expect(await f.registry.dispatch({ ...f.request, operation: 'listTargets', input: {} })).toEqual({ targets: [{ targetRef: 'opaque-target', resourcePath: canonicalWorkspacePath(f.path), label: 'Review' }] })
    const result = await f.registry.dispatch(f.request) as Record<string, unknown>
    expect(result).toMatchObject({ ok: true, width: 2, height: 2, redacted: true, source: { instanceId: 'instance-test', resourcePath: canonicalWorkspacePath(f.path), threadId: 'thread-1', redactionPolicy: 'registered-target-v1' } })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    expect(f.captures()).toBe(1)
  })

  it('requires live lease, exact owner and currently granted operation', async () => {
    const f = await fixture()
    await expect(f.registry.dispatch({ ...f.request, assertCurrent: undefined })).rejects.toThrow(/lease/)
    await expect(f.registry.dispatch({ ...f.request, owner: { ...f.request.owner, generation: 2 } })).rejects.toThrow(/authorized/)
    f.revokePort()
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/authorized/)
    expect(f.captures()).toBe(0)
  })

  it('rejects foreign caller workspace, non-agent and foreign active thread', async () => {
    const f = await fixture()
    for (const caller of [{ audience: 'agent', callerId: 'caller', workspaceId: f.root }, { audience: 'ui', callerId: 'caller', workspaceId: f.workspace }]) {
      await expect(f.registry.dispatch({ ...f.request, owner: { ...f.request.owner, authority: { ...f.request.owner.authority, caller } } })).rejects.toThrow()
    }
    f.snapshot.activeThreadId = 'foreign-thread'
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/bound task/)
    expect(f.captures()).toBe(0)
  })

  it('refuses redacted, whole-window, stale and foreign-resource targets without capture', async () => {
    const f = await fixture()
    const target = f.snapshot.components[0]!.visualTargets![0]!
    target.redact = true
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/registered task/)
    target.redact = false
    target.kind = 'window'
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/registered task/)
    target.kind = 'component'
    f.latest.freshness.stale = true
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/registered task/)
    f.latest.freshness.stale = false
    f.snapshot.components[0]!.resources![0]!.path = join(f.root, 'foreign.md')
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/registered task/)
    expect(f.captures()).toBe(0)
  })

  it('rejects symlink escapes and mismatched expected resource selectors', async () => {
    const f = await fixture()
    await expect(f.registry.dispatch({ ...f.request, input: { targetRef: 'opaque-target', expectedResourcePath: join(f.workspace, 'other.md') } })).rejects.toThrow(/registered task/)
    await symlink(f.root, join(f.workspace, 'escape'))
    f.snapshot.components[0]!.resources = [{ kind: 'file', relativePath: 'escape/secret.md' }]
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/registered task/)
    expect(f.captures()).toBe(0)
  })

  it('accepts refreshed layout revisions only for the same bound resource and target', async () => {
    const f = await fixture()
    f.latest.revision = 4
    f.snapshot.freshness.stale = true
    f.onCapture(() => { f.latest.revision++ })
    await expect(f.registry.dispatch(f.request)).resolves.toMatchObject({ ok: true, source: { validatedRevision: 4, captureRevisionAtomic: false } })
    f.latest.components[0]!.resources![0]!.path = join(f.workspace, 'other.md')
    await expect(f.registry.dispatch(f.request)).rejects.toThrow(/registered task/)
    expect(f.captures()).toBe(1)
  })

  it('discards in-flight capture when lease, resource, window or active thread changes', async () => {
    for (const change of ['lease', 'resource', 'window', 'thread'] as const) {
      const f = await fixture()
      f.onCapture(() => {
        if (change === 'lease') f.revoke()
        else if (change === 'resource') f.latest.components[0]!.resources![0]!.path = join(f.workspace, 'other.md')
        else if (change === 'window') f.latest.windowId = 'other'
        else f.latest.activeThreadId = 'other'
      })
      await expect(f.registry.dispatch(f.request)).rejects.toThrow()
      expect(f.captures()).toBe(1)
    }
  })
})
