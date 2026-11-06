/**
 * Shared host harness for the plugin's hot-plug tests (E2–E4).
 *
 * Builds a throwaway plugin root, installs the built artifact, and drives the
 * real `DevelopmentExternalPluginService` + `CapabilityRegistry`. No Electron,
 * no user data, no GUI.
 *
 * Exact-version Host grants and the generic visualCapture service client are
 * composed explicitly. The service has no registered task view and refuses
 * capture; no fixture result is screenshot acceptance evidence.
 */
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PluginAdapterContract, HostServiceClientFactory, HostServiceProvider, HostServiceRequest } from '@sciforge/plugin-sdk'
import assert from 'node:assert/strict'

export const VISUAL_PORTS = ['visual-capture.read', 'visual-capture.capture'] as const
export const VISUAL_CLIENT: HostServiceClientFactory = {
  serviceId: 'visualCapture',
  modulePath: fileURLToPath(new URL('../../../packages/plugin-sdk/src/host-service-client.mjs', import.meta.url)),
  exportName: 'createHostServiceClient',
  config: { serviceId: 'visualCapture' }
}
/** Engineering fixture: no task view is registered, so capture always refuses. */
export function unavailableVisualProvider(calls: HostServiceRequest[] = [], authorize?: (request: HostServiceRequest) => void): HostServiceProvider {
  return {
    authorize(request) {
      request.assertCurrent?.()
      authorize?.(request)
      const caller = request.owner.authority.caller as { workspaceId?: string } | undefined
      assert.ok(caller?.workspaceId, 'visual service needs Host-bound caller workspace')
      assert.ok(request.owner.authority.ordinarySession, 'visual service needs Host-bound session')
      calls.push(request)
    },
    operations: {
      listTargets: () => ({ targets: [] }),
      captureRegisteredTarget: () => ({ ok: false, error: { code: 'target-not-found', message: 'No authorized task view is registered in this test.' } })
    }
  }
}
import { DevelopmentExternalPluginService } from '../../../src/main/extensions/development-external-plugins.js'
import { CapabilityRegistry } from '../../../src/main/capabilities/registry.js'
import { createWorkspaceAuthority } from '../../../src/main/extensions/workspace-authority.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'

export const PACKAGE_NAME = '@sciforge/plugin-anchored-comments'
export const PACKAGE_VERSION = '0.2.1'
export const DSH_RUNTIME_VERSION = '0.2.0-rc.2'
export const PLUGIN_SOURCE = fileURLToPath(new URL('..', import.meta.url))
export const DECLARED_IDS = Object.values(EXPECTED_HOST_GRANTS).map((grant) => grant.id).sort()

/** Ids the host actually registers through `DevelopmentExternalPluginService`. */
export const EXPECTED_IDS: readonly string[] = DECLARED_IDS

export type Harness = Readonly<{
  root: string
  pluginsRoot: string
  workspaceRoot: string
  service: DevelopmentExternalPluginService
  registry: CapabilityRegistry
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
      ports: [...VISUAL_PORTS],
      tools: { ...EXPECTED_HOST_GRANTS }
    }
  } as PluginAdapterContract
}

async function installPlugin(
  directory: string,
  options: Readonly<{
    packageName?: string
    version?: string
    brokenEntry?: boolean
  }> = {}
): Promise<void> {
  await mkdir(join(directory, 'dist'), { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'sciforge.dsh.json']) {
    await cp(join(PLUGIN_SOURCE, file), join(directory, file))
  }
  await cp(join(PLUGIN_SOURCE, 'dist', 'ui'), join(directory, 'dist', 'ui'), { recursive: true })
  if (options.brokenEntry) {
    await writeFile(
      join(directory, 'dist', 'main.js'),
      "throw new Error('simulated activation failure')\n"
    )
  } else {
    await cp(join(PLUGIN_SOURCE, 'dist', 'main.js'), join(directory, 'dist', 'main.js'))
  }
  if (options.packageName !== undefined || options.version !== undefined) {
    const packagePath = join(directory, 'package.json')
    const parsed = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
    if (options.packageName !== undefined) parsed.name = options.packageName
    if (options.version !== undefined) parsed.version = options.version
    await writeFile(packagePath, `${JSON.stringify(parsed, null, 2)}\n`)
    const manifestPath = join(directory, 'sciforge.dsh.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    if (options.packageName !== undefined) manifest.packageName = options.packageName
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

export async function createHarness(
  options: Readonly<{
    approved?: boolean
    contractVersion?: string
    clonePackageName?: string
    brokenEntry?: boolean
    userDataRoot?: string
  }> = {}
): Promise<Harness> {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'anchored-comments-host-'))
  await mkdir(join(root, 'workspace'))
  const workspaceRoot = await realpath(join(root, 'workspace'))
  const pluginsRoot = join(root, 'plugins')
  const directory = join(pluginsRoot, 'anchored-comments')
  await installPlugin(directory, { brokenEntry: options.brokenEntry })

  let cloneName: string | undefined
  if (options.clonePackageName !== undefined) {
    cloneName = options.clonePackageName
    await installPlugin(join(pluginsRoot, 'anchored-comments-clone'), {
      packageName: cloneName
    })
  }

  const contracts = new Map<string, PluginAdapterContract>()
  if (options.approved !== false) {
    contracts.set(PACKAGE_NAME, contractFor(PACKAGE_NAME, options.contractVersion ?? PACKAGE_VERSION))
    if (cloneName !== undefined) {
      contracts.set(cloneName, contractFor(cloneName, PACKAGE_VERSION))
    }
  }

  // G9: ordinary-Session invocations need a child-local ordinary Agent resolver.
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
  const service = new DevelopmentExternalPluginService({
    root: pluginsRoot,
    dshAgentResolver: { path: resolverPath },
    userDataPath: options.userDataRoot ?? join(root, 'data'),
    hostApiVersion: '1.0.0',
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    adapterContracts: contracts,
    authorizeWorkspace: createWorkspaceAuthority({ readTrustedRoots: () => [workspaceRoot] }),
    resolveHostServiceClients: () => [VISUAL_CLIENT],
    hostServiceProviders: { visualCapture: unavailableVisualProvider([], (request) => {
      const contract = contracts.get(request.owner.packageName)
      const grant = contract?.dshAuthorization
      const port = request.operation === 'listTargets' ? 'visual-capture.read' : 'visual-capture.capture'
      assert.ok(contract?.approved && grant?.packageName === request.owner.packageName && grant.packageVersion === request.owner.version && grant.ports?.includes(port), 'exact-version Host visual port authorization is missing')
    }) },
    allowedPermissionIds: new Set()
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
    contracts,
    dispose: async () => {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }
  }
}

export function anchoredCommentIds(registry: CapabilityRegistry): readonly string[] {
  return registry.list()
    .map(({ id }) => id)
    .filter((id) => id.startsWith('anchored-comments.') && !id.endsWith('.open'))
    .sort()
}

/** Workspace-resource openers the Host derives from the four read grants. */
export function anchoredCommentOpeners(registry: CapabilityRegistry): readonly string[] {
  return registry.list()
    .map(({ id }) => id)
    .filter((id) => id.startsWith('anchored-comments.') && id.endsWith('.open'))
    .sort()
}

export async function activationStateOf(
  harness: Harness,
  packageName = PACKAGE_NAME
): Promise<string | undefined> {
  const summary = (await harness.service.list()).find((entry) => entry.packageName === packageName)
  return summary?.activationState
}

export { mkdtemp, mkdir, rm, join }