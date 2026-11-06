/** Real-process coverage for the generic Host Artifact Versions service. */
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isDomainMainRuntimeLifecycleContribution } from '@sciforge/domain-sdk/host'
import { createDomainMainEntry, type ArtifactVersionsCapabilityOptions } from '@sciforge/domain-artifact-versions/main'
import { ARTIFACT_HOST_SERVICE_ID, createDomainHostServiceResolver, type ArtifactHostServiceOptions } from '@sciforge/domain-artifact-versions/host-services'
import {
  type ArtifactVersionCommitInputV1,
  type ArtifactVersionCommitResultV1,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import { HostServiceProviderRegistry, ProcessExtensionHost, type HostServiceInvocation, type HostServiceRequest } from '@sciforge/plugin-sdk'
import { CapabilityBroker } from '../capabilities/broker'
import { CapabilityRegistry, defineCapability } from '../capabilities/registry'
import { createWorkspaceAuthority } from './workspace-authority'

const PACKAGE = { name: 'artifact-client-fixture', version: '1.0.0' } as const
const CLIENT_MODULE = fileURLToPath(new URL('../../../packages/plugin-sdk/src/host-service-client.mjs', import.meta.url))

const roots: string[] = []
const hosts: ProcessExtensionHost[] = []
const deactivators: Array<() => Promise<void> | void> = []

afterEach(async () => {
  await Promise.all(deactivators.splice(0).map(async (deactivate) => { await deactivate() }))
  await Promise.all(hosts.splice(0).map((host) => host.disposeAll()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

/**
 * Compose the real Artifact Versions domain entry, the real Broker and the real
 * provider. Returns the codec-level service handle for direct `commit`/`read`
 * assertions; plugin tool calls go through the child instead.
 */
async function compose(options: Readonly<{ workspaceRoot: string; userDataDir: string; authorizeWorkspace?: (input: { caller: Record<string, unknown>; workspaceId: string }) => boolean | Promise<boolean> }>) {
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  const entry = createDomainMainEntry<ArtifactVersionsCapabilityOptions>({
    getUserDataDir: () => options.userDataDir,
    defineCapability: (capabilityOptions) => capabilityOptions
  })
  const lifecycle = entry.contributions.find((contribution) => contribution.kind === 'main.runtime-lifecycle')?.value
  const factory = entry.contributions.find((contribution) => contribution.kind === 'main.capability-factory')?.value
  if (!isDomainMainRuntimeLifecycleContribution(lifecycle) || !factory || !('createDefinitions' in factory)) {
    throw new Error('Artifact Versions main contributions are incomplete.')
  }
  for (const { audiences, tags, ...definition } of factory.createDefinitions()) {
    registry.register(defineCapability({ ...definition, audiences: [...audiences], tags: [...tags] }))
  }
  const unexpected = () => { throw new Error('Unexpected Artifact Versions Host callback.') }
  const deactivate = await lifecycle.activate({
    userDataDir: options.userDataDir, appRoot: options.userDataDir, environment: {},
    owner: { moduleId: entry.definition.module.id, moduleVersion: entry.definition.module.version },
    signal: new AbortController().signal,
    agentThreads: { list: async () => [], read: async () => unexpected(), subscribeMessages: async function* () {}, hasActiveTurns: () => false },
    capabilities: { invoke: async () => unexpected(), createApprovedBatch: unexpected },
    modelAccess: { textReasoner: async () => unexpected() },
    executionEvents: { publish: async () => unexpected() },
    enablement: { isEnabled: () => true, subscribe: () => unexpected() },
    workflowExecutionReceipts: [], log: () => {}
  })
  const resolverOptions: ArtifactHostServiceOptions = {
    capabilities: {
      invoke: async (request, context) => {
        context.assertCurrent()
        context.signal.throwIfAborted()
        const result = await broker.invokeOrdinarySession(
          context.caller as never,
          request as never,
          context.ordinarySession as never,
          { signal: context.signal, ...(context.originalContext ? { context: context.originalContext } : {}) }
        )
        context.assertCurrent()
        context.signal.throwIfAborted()
        return result.output
      }
    },
    authorizeWorkspace: options.authorizeWorkspace,
    authorizeHostService: ({ packageName, version, serviceId }) =>
      packageName === PACKAGE.name && version === PACKAGE.version && serviceId === ARTIFACT_HOST_SERVICE_ID,
    hostServiceClientModule: CLIENT_MODULE
  }
  const resolver = createDomainHostServiceResolver(resolverOptions)
  deactivators.push(async () => { if (typeof deactivate === 'function') await deactivate() })
  const providers = resolver.resolve(PACKAGE.name, PACKAGE.version, 1)
  if (!providers) throw new Error('The Host artifact provider was not resolved for the plugin.')
  return { registry, broker, providers, provider: providers[ARTIFACT_HOST_SERVICE_ID]!, deactivate }
}

function invocation(
  operation: string,
  effect: 'read' | 'workspace-write',
  workspaceRoot: string,
  overrides: Readonly<Record<string, unknown>> = {}
): HostServiceInvocation {
  const session = { runtimeId: 'acceptance-runtime', threadId: 'thread-1' }
  return {
    authority: Object.freeze({
      caller: Object.freeze({ audience: 'agent', callerId: 'acceptance-agent', workspaceId: workspaceRoot }),
      capabilityId: operation,
      effect,
      invocationId: `acceptance-${operation}`,
      ordinarySession: Object.freeze(session),
      ...(overrides.authority ? overrides.authority as Record<string, unknown> : {})
    }),
    services: Object.freeze([ARTIFACT_HOST_SERVICE_ID]),
    assertCurrent: () => undefined,
    ...(overrides.services ? { services: overrides.services as readonly string[] } : {})
  }
}

type CommitItem = Readonly<{ candidateId: string; versionId: string; ref: ArtifactVersionRefV1 }>

function commitItems(result: unknown): readonly CommitItem[] {
  const parsed = result as ArtifactVersionCommitResultV1
  if (!parsed.ok) throw new Error(parsed.issue.message)
  return parsed.value.versions.map((item) => ({
    candidateId: item.candidateId,
    versionId: item.version.versionId,
    ref: item.ref
  }))
}

describe('Host Artifact Versions service (real child, real Broker)', () => {
  it('commits, reads, and fences artifact requests without a domain plugin or Python', async () => {
    const workspaceRoot = await tempRoot('artifact-host-workspace-')
    const userDataDir = await tempRoot('artifact-host-userdata-')
    const { providers } = await compose({
      workspaceRoot, userDataDir,
      authorizeWorkspace: createWorkspaceAuthority({ readTrustedRoots: () => [workspaceRoot] })
    })
    const entryPath = join(await tempRoot('artifact-client-'), 'entry.mjs')
    await writeFile(entryPath, `export function getCapabilityDefinitions() { return [{
      descriptor: { id: 'fixture.artifacts' },
      handler: async (input) => globalThis.__sciforgeHostServices.request(
        ${JSON.stringify(ARTIFACT_HOST_SERVICE_ID)}, input.operation, input.payload
      ).result
    }] }`)
    const host = new ProcessExtensionHost({ hostServices: new HostServiceProviderRegistry(providers) })
    hosts.push(host)
    await host.replace({ pluginId: PACKAGE.name, packageName: PACKAGE.name, version: PACKAGE.version, entryPath })
    const runtime = host.runtime(PACKAGE.name)!
    const invoke = (operation: string, input: unknown, effect: 'read' | 'workspace-write', root = workspaceRoot, signal?: AbortSignal) =>
      runtime.invoke('fixture.artifacts', { operation, payload: { workspaceRoot: root, input } }, undefined, signal, undefined, undefined,
        invocation('fixture.artifacts', effect, workspaceRoot))
    const commitInput: ArtifactVersionCommitInputV1 = {
      idempotencyKey: 'generic-artifact-commit',
      candidates: [{ candidateId: 'fixture-artifact', expectedCurrentVersionId: null, kind: 'figure', intent: 'save',
        content: { mode: 'snapshot', dataBase64: 'YQ==' },
        accessPolicy: { visibility: 'workspace', principals: [], allowExport: true } }]
    }
    const committed = await invoke('commit', commitInput, 'workspace-write')
    const version = commitItems(committed)[0]
    expect(version).toBeDefined()
    const read = await invoke('read', { versionId: version.versionId }, 'read') as { ok: boolean; value: { dataBase64: string } }
    expect(read).toMatchObject({ ok: true, value: { dataBase64: 'YQ==' } })
    const replay = await invoke('commit', commitInput, 'workspace-write')
    expect(commitItems(replay)[0].versionId).toBe(version.versionId)
    await expect(invoke('commit', { ...commitInput, candidates: [{ ...commitInput.candidates[0], content: { mode: 'snapshot', dataBase64: 'Yg==' } }] }, 'workspace-write')).rejects.toThrow(/different request/u)
    await expect(invoke('read', { versionId: version.versionId }, 'read', await tempRoot('artifact-foreign-'))).rejects.toThrow(/caller-bound workspace root|not authorized/u)
    const aborted = new AbortController()
    aborted.abort(new Error('cancelled artifact request'))
    await expect(invoke('commit', { ...commitInput, idempotencyKey: 'cancelled-commit' }, 'workspace-write', workspaceRoot, aborted.signal)).rejects.toThrow()
    await runtime.dispose()
    await runtime.dispose()
    await expect(invoke('read', { versionId: version.versionId }, 'read')).rejects.toThrow(/disposed|stale|inactive/i)
  })
})

describe('Host Artifact Versions admission', () => {
  it('refuses to activate when the Host promised artifacts but wired no provider', { timeout: 120_000 }, async () => {
    // This is a generic service-admission contract. The standalone figures
    // plugin no longer consumes Artifact Versions, so do not use its bundle as
    // a fixture for an artifact client dependency.
    const root = await tempRoot('artifact-client-admission-')
    const entryPath = join(root, 'artifact-client.mjs')
    const activatedPath = join(root, 'activated')
    await writeFile(entryPath, `
import { writeFile } from 'node:fs/promises'
export const inject = [${JSON.stringify(ARTIFACT_HOST_SERVICE_ID)}]
export async function apply(ctx) {
  const client = ctx[${JSON.stringify(ARTIFACT_HOST_SERVICE_ID)}]
  if (client?.serviceId !== ${JSON.stringify(ARTIFACT_HOST_SERVICE_ID)} || typeof client.invoke !== 'function') {
    throw new Error('Artifact client was not supplied by the trusted Host factory.')
  }
  await writeFile(${JSON.stringify(activatedPath)}, 'activated')
}
`)
    const identity = { pluginId: 'artifact-client-fixture', packageName: 'artifact-client-fixture', version: '1.0.0', entryPath }
    const missingProviderHost = new ProcessExtensionHost()
    hosts.push(missingProviderHost)
    await expect(missingProviderHost.replace(identity)).rejects.toThrow(/Plugin dependencies are not ready \(0\)/u)
    expect(missingProviderHost.runtime(identity.packageName)).toBeUndefined()
    await expect(readFile(activatedPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    // Prove that the same fixture activates when the real domain resolver
    // supplies its approved provider and trusted client, without invoking or
    // mutating the artifact store merely to test dependency admission.
    const resolver = createDomainHostServiceResolver({
      capabilities: { invoke: async () => { throw new Error('Admission must not invoke an artifact operation.') } },
      authorizeHostService: () => true,
      authorizeWorkspace: () => true,
      hostServiceClientModule: CLIENT_MODULE
    })
    expect(resolver.resolve(identity.packageName, identity.version, 1)?.[ARTIFACT_HOST_SERVICE_ID]).toBeDefined()
    const suppliedProviderHost = new ProcessExtensionHost({
      resolveHostServices: (packageName, version, generation) => new HostServiceProviderRegistry(resolver.resolve(packageName, version, generation) ?? {}),
      resolveServiceClients: resolver.resolveClients
    })
    hosts.push(suppliedProviderHost)
    await suppliedProviderHost.replace(identity)
    expect(suppliedProviderHost.runtime(identity.packageName)?.snapshot.state).toBe('active')
    expect(await readFile(activatedPath, 'utf8')).toBe('activated')
  })
})

describe('Artifact Host service caller projection', () => {
  it('re-submits only the public caller identity to the Broker', async () => {
    const seen: unknown[] = []
    const resolver = createDomainHostServiceResolver({
      capabilities: {
        invoke: async (
          _request: Parameters<ArtifactHostServiceOptions['capabilities']['invoke']>[0],
          context: Parameters<ArtifactHostServiceOptions['capabilities']['invoke']>[1]
        ) => {
          seen.push(context.caller)
          throw new Error('stop after capture')
        }
      },
      authorizeHostService: () => true,
      authorizeWorkspace: () => true,
      hostServiceClientModule: CLIENT_MODULE
    })
    const provider = resolver.resolve(PACKAGE.name, PACKAGE.version, 1)?.[ARTIFACT_HOST_SERVICE_ID]
    expect(provider).toBeDefined()
    const request = {
      requestId: 'caller-projection',
      serviceId: ARTIFACT_HOST_SERVICE_ID,
      operation: 'read',
      owner: {
        pluginId: PACKAGE.name,
        version: PACKAGE.version,
        profileId: '/workspace',
        connectionId: 'connection-1',
        packageName: PACKAGE.name,
        generation: 1,
        authority: {
          caller: {
            audience: 'agent',
            callerId: 'agent-1',
            workspaceId: '/workspace',
            approvals: [],
            // Host-injected fields the public Broker schema does not accept:
            principal: { userId: 'u1' },
            principalContextVersion: 4
          },
          capabilityId: 'scientific-plotting.read',
          effect: 'read',
          ordinarySession: { runtimeId: 'codex', threadId: 'thread-1' }
        }
      },
      input: { workspaceRoot: '/workspace', input: { versionId: 'artifact-version:x' } },
      signal: new AbortController().signal,
      assertCurrent: () => {}
    } as unknown as HostServiceRequest
    await expect(provider!.operations.read(request)).rejects.toThrow('stop after capture')
    expect(seen).toEqual([{
      audience: 'agent',
      callerId: 'agent-1',
      workspaceId: '/workspace',
      approvals: []
    }])
  })
})