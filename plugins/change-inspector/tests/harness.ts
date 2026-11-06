/**
 * Shared host harness for the plugin's hot-plug tests (E2–E4).
 *
 * Builds a throwaway plugin root, installs the built artifact, and drives the
 * real `DevelopmentExternalPluginService` + `CapabilityRegistry`. No Electron,
 * no user data, no GUI.
 *
 * The Host injects its real generic agentThreads provider/resolver. Only the
 * recorded Host aggregate and ordinary Agent resolver are test sources; plugin
 * config never carries sessions and tool inputs never carry sessionDetail.
 * This exercises child-process wiring, not live Agent or packaged acceptance.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { DevelopmentExternalPluginService } from '../../../src/main/extensions/development-external-plugins.js'
import { CapabilityRegistry } from '../../../src/main/capabilities/registry.js'
import { CapabilityBroker } from '../../../src/main/capabilities/broker.js'
import { createAgentThreadsHostServiceResolver, AGENT_THREADS_READ_PORT } from '../../../src/main/extensions/agent-threads-host-service.js'
import { createWorkspaceAuthority } from '../../../src/main/extensions/workspace-authority.js'
import type { AgentRuntimeThreadSnapshot } from '../../../src/shared/agent-runtime-contract.js'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'

export const PACKAGE_NAME = '@sciforge/plugin-change-inspector'
export const PACKAGE_VERSION: string = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
export const DSH_RUNTIME_VERSION = '0.2.0-rc.2'
export const PLUGIN_SOURCE = fileURLToPath(new URL('..', import.meta.url))
/** What the manifest asks the host to grant. */
export const DECLARED_IDS = Object.values(EXPECTED_HOST_GRANTS).map((grant) => grant.id).sort()
/** What the host registers: the granted `read` tool, projected by its own grant. */
export const EXPECTED_IDS = [
  CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges,
  CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
]

export type Harness = Readonly<{
  root: string
  pluginsRoot: string
  workspaceRoot: string
  service: DevelopmentExternalPluginService
  registry: CapabilityRegistry
  broker: CapabilityBroker
  caller: { audience: 'agent'; callerId: string; workspaceId: string }
  ordinarySession: { runtimeId: 'codex'; threadId: string }
  snapshotReads: { runtimeId: string; threadId: string }[]
  contracts: Map<string, PluginAdapterContract>
  dispose: () => Promise<void>
}>

export function contractFor(
  packageName: string,
  packageVersion: string
): PluginAdapterContract {
  return {
    hostApiRange: '^1.0.0',
    permissions: [],
    approved: true,
    dshAuthorization: {
      packageName,
      packageVersion,
      dshRuntimeVersion: DSH_RUNTIME_VERSION,
      tools: { ...EXPECTED_HOST_GRANTS },
      ports: [AGENT_THREADS_READ_PORT]
    }
  } as PluginAdapterContract
}

/** Installs the built plugin into `directory`; `brokenEntry` throws on activation. */
export async function installPlugin(
  directory: string,
  options: Readonly<{ brokenEntry?: boolean }> = {}
): Promise<void> {
  await mkdir(join(directory, 'dist'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'sciforge.dsh.json']) {
    await cp(join(PLUGIN_SOURCE, file), join(directory, file))
  }
  if (options.brokenEntry) {
    await writeFile(
      join(directory, 'dist', 'main.js'),
      "throw new Error('simulated activation failure')\n"
    )
    return
  }
  await cp(join(PLUGIN_SOURCE, 'dist', 'main.js'), join(directory, 'dist', 'main.js'))
}

export async function createHarness(
  options: Readonly<{
    approved?: boolean
    contractVersion?: string
    brokenEntry?: boolean
    userDataRoot?: string
    beforeSnapshotRead?: (signal: AbortSignal) => Promise<void>
  }> = {}
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'change-inspector-host-'))
  const pluginsRoot = join(root, 'plugins')
  await installPlugin(join(pluginsRoot, 'change-inspector'), { brokenEntry: options.brokenEntry })
  // Child-local ordinary Agent resolver: without it the runner refuses to
  // invoke any tool ("DSH ordinary Session invocation envelope is required").
  const resolverPath = join(root, 'agent-resolver.mjs')
  await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}
`)

  const contracts = new Map<string, PluginAdapterContract>()
  if (options.approved !== false) {
    contracts.set(PACKAGE_NAME, contractFor(PACKAGE_NAME, options.contractVersion ?? PACKAGE_VERSION))
  }

  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  const caller = { audience: 'agent' as const, callerId: 'test-host-agent', workspaceId: workspaceRoot }
  const ordinarySession = { runtimeId: 'codex' as const, threadId: 'thread-invoke' }
  const snapshotReads: { runtimeId: string; threadId: string }[] = []
  // Recorded Host aggregate supplied only by tests; never production plugin config.
  const snapshot: AgentRuntimeThreadSnapshot = {
    id: ordinarySession.threadId, runtimeId: ordinarySession.runtimeId, title: 'Recorded test Session',
    updatedAt: '2026-11-03T00:00:00Z', workspace: workspaceRoot, latestSeq: 1,
    turns: [{ id: 'turn-1', threadId: ordinarySession.threadId, status: 'completed', items: [{
      kind: 'tool', toolKind: 'file_change', id: 'invoke-artifact', status: 'success',
      detail: '--- a/src/invoke.ts\n+++ b/src/invoke.ts\n@@ -1 +1 @@\n-a\n+b'
    }] }]
  }
  const resolver = createAgentThreadsHostServiceResolver({
    hostServiceClientModule: fileURLToPath(new URL('../../../packages/plugin-sdk/src/host-service-client.mjs', import.meta.url)),
    authorizeWorkspace: createWorkspaceAuthority({ readTrustedRoots: () => [workspaceRoot] }),
    readGrantedPorts: ({ packageName, version }) => {
      const contract = contracts.get(packageName)
      return contract?.approved && contract.dshAuthorization?.packageVersion === version
        ? contract.dshAuthorization.ports : undefined
    },
    readSnapshot: async ({ runtimeId, threadId, signal }) => {
      snapshotReads.push({ runtimeId, threadId })
      await options.beforeSnapshotRead?.(signal)
      return snapshot
    }
  })
  const service = new DevelopmentExternalPluginService({
    root: pluginsRoot,
    userDataPath: options.userDataRoot ?? join(root, 'data'),
    hostApiVersion: '1.0.0',
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    adapterContracts: contracts,
    allowedPermissionIds: new Set(),
    resolveHostServiceProviders: resolver.resolve,
    resolveHostServiceClients: resolver.resolveClients,
    hostServiceIds: resolver.serviceIds,
    authorizeWorkspace: createWorkspaceAuthority({ readTrustedRoots: () => [workspaceRoot] }),
    dshAgentResolver: { path: resolverPath }
  })
  const registry = new CapabilityRegistry()
  await service.initialize()
  await service.attachCapabilityRegistry(registry)

  return {
    root,
    pluginsRoot,
    workspaceRoot,
    service,
    registry,
    broker: new CapabilityBroker(registry),
    caller,
    ordinarySession,
    snapshotReads,
    contracts,
    dispose: async () => {
      await service.dispose()
      const target = resolve(root)
      if (dirname(target) !== resolve(tmpdir()) || !target.split(/[\\/]/).at(-1)?.startsWith('change-inspector-host-')) {
        throw new Error(`Refusing to remove unexpected harness directory: ${target}`)
      }
      await rm(target, { recursive: true, force: true })
    }
  }
}

/** Obtain a real caller-bound Broker resource before invoking a public read tool. */
export async function invokeHarness(
  harness: Harness,
  actionId: string,
  input: unknown,
  caller = harness.caller,
  options: { signal?: AbortSignal } = {}
): Promise<Awaited<ReturnType<CapabilityBroker['invokeOrdinarySession']>>> {
  const opener = harness.registry.list().find(item => item.tags.includes('dsh-session-opener'))
  if (!opener) throw new Error('DSH Session opener is unavailable.')
  const resource = (await harness.broker.invokeOrdinarySession(caller, {
    actionId: opener.id, input: {}
  }, harness.ordinarySession)).output as { token: string; semanticRevision: string; expiresAt: string }
  return harness.broker.invokeOrdinarySession(caller, { actionId, input: z.json().parse(input), resource }, harness.ordinarySession, options)
}

/** Capability ids the host registry holds for this plugin. */
export function changeInspectorIds(registry: CapabilityRegistry): readonly string[] {
  return registry
    .list()
    .map(({ id }) => id)
    .filter((id) => id.startsWith('change-inspector.'))
    .sort()
}

export async function activationStateOf(
  harness: Harness,
  packageName = PACKAGE_NAME
): Promise<string | undefined> {
  const summary = (await harness.service.list()).find((entry) => entry.packageName === packageName)
  return summary?.activationState
}

export async function generationOf(
  harness: Harness,
  packageName = PACKAGE_NAME
): Promise<number | undefined> {
  return (await harness.service.updateStatus(packageName)).generation
}

export { mkdtemp, mkdir, rm, join, readFile, writeFile, cp }