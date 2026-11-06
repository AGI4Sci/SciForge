/**
 * Workspace binding for DSH plugin tools — regression for the review finding:
 * "the runner projects every non-read tool as `global`, and the host only
 * overwrites `workspaceRoot` for `workspace`-scoped capabilities, so a
 * workspace-write plugin tool trusts whatever path the caller sent".
 *
 * The fixture plugin is a neutral consumer: it has one `workspace-write` tool
 * that declares workspace scope and one `compute` tool that does not. The test
 * drives the real host path (discovery, approval, activation, broker
 * registration, real child-process call, unload), not the runner in isolation.
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { bindWorkspaceArgument, declaresWorkspaceArgument } from '@sciforge/plugin-sdk'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { createWorkspaceAuthority } from './workspace-authority'
import { CapabilityRegistry } from '../capabilities/registry'

const PACKAGE_NAME = '@sciforge/plugin-workspace-note'
const PACKAGE_VERSION = '0.1.0'
const DSH_RUNTIME_VERSION = '0.2.0-rc.2'
const PLUGIN_SOURCE = resolve(__dirname, '../../../tests/fixtures/dsh-plugins/workspace-note')

const temporaryDirectories: string[] = []

beforeAll(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: PLUGIN_SOURCE, stdio: 'pipe' })
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

async function createHarness(options: Readonly<{
  withServices?: boolean
  workspaceAuthorized?: boolean
  authorizeWorkspace?: (input: Readonly<{ caller: Record<string, unknown>; workspaceId: string }>) => boolean | Promise<boolean>
}> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-binding-'))
  temporaryDirectories.push(root)

  const pluginsRoot = join(root, 'plugins')
  const pluginDirectory = join(pluginsRoot, 'workspace-note')
  await mkdir(pluginDirectory, { recursive: true })
  for (const file of ['package.json', 'cordis.patch.yml', 'sciforge.dsh.json']) {
    await cp(join(PLUGIN_SOURCE, file), join(pluginDirectory, file))
  }
  await cp(join(PLUGIN_SOURCE, 'dist', 'main.js'), join(pluginDirectory, 'dist', 'main.js'))

  const contract: PluginAdapterContract = {
    hostApiRange: '^1.0.0',
    permissions: [],
    approved: true,
    dshAuthorization: {
      packageName: PACKAGE_NAME,
      packageVersion: PACKAGE_VERSION,
      dshRuntimeVersion: DSH_RUNTIME_VERSION,
      tools: {
        workspace_note_write: { id: 'workspace-note.write', effect: 'workspace-write', scope: 'workspace' },
        workspace_note_probe: { id: 'workspace-note.probe', effect: 'compute', scope: 'workspace' },
        workspace_note_report: { id: 'workspace-note.report', effect: 'compute' }
      }
    }
  } as PluginAdapterContract

  const withServices = options.withServices !== false
  const service = new DevelopmentExternalPluginService({
    // Fixture Host authority; one case turns it off to prove the gate, and one
    // case swaps in the real authority to prove the composed decision.
    authorizeWorkspace: options.authorizeWorkspace ?? (() => options.workspaceAuthorized !== false),
    root: pluginsRoot,
    userDataPath: join(root, 'data'),
    hostApiVersion: '1.0.0',
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    adapterContracts: new Map([[PACKAGE_NAME, contract]]),
    // A non-compute DSH tool is admitted only when the host composed a service
    // lane for the plugin; this trivial echo provider stands in for the real
    // Artifact Versions service so the fixture exercises the binding rule and
    // not the admission rule. `withServices: false` reproduces a marketplace
    // composition that has no service lane at all.
    ...(withServices ? {
      hostServiceProviders: {
        'workspace-note.echo': { authorize: () => {}, operations: { echo: (request: { input: unknown }) => request.input } }
      },
      hostServiceIds: ['workspace-note.echo'],
      resolveHostServiceClients: () => [{
        serviceId: 'workspace-note.echo',
        modulePath: join(PLUGIN_SOURCE, 'host-client.mjs'),
        exportName: 'createClient',
        config: {}
      }]
    } : {})
  })

  const registry = new CapabilityRegistry()
  await service.initialize()
  await service.attachCapabilityRegistry(registry)

  const callerWorkspace = join(root, 'caller-workspace')
  const foreignWorkspace = join(root, 'foreign-workspace')
  await mkdir(callerWorkspace, { recursive: true })

  return { root, service, registry, callerWorkspace, foreignWorkspace }
}

describe('DSH plugin workspace binding', () => {
  it('projects a declared workspace-write tool as workspace scope, not global', async () => {
    const harness = await createHarness()
    try {
      await harness.service.setEnabled(PACKAGE_NAME, true)
      const write = harness.registry.require('workspace-note.write')
      const report = harness.registry.require('workspace-note.report')
      expect(write.descriptor.scope).toBe('workspace')
      // An undeclared tool keeps the effect-derived projection: no workspace binding.
      expect(report.descriptor.scope).toBe('global')
    } finally {
      await harness.service.dispose()
    }
  }, 120_000)

  it('rejects an explicit foreign root before effects, then binds an omitted root from the caller', async () => {
    const harness = await createHarness()
    try {
      await harness.service.setEnabled(PACKAGE_NAME, true)
      const write = harness.registry.require('workspace-note.write')

      await expect(write.handler(
        { workspaceRoot: harness.foreignWorkspace, text: 'rejected', __sciforgeHostWorkspace: 'host' },
        { caller: { workspaceId: harness.callerWorkspace }, assertPrincipalCurrent: () => {} } as never
      )).rejects.toThrow(/rejects a workspaceRoot/)
      expect(existsSync(join(harness.callerWorkspace, 'workspace-note.txt'))).toBe(false)
      expect(existsSync(harness.foreignWorkspace)).toBe(false)
      const result = await write.handler(
        { text: 'bound' },
        { caller: { workspaceId: harness.callerWorkspace }, assertPrincipalCurrent: () => {} } as never
      ) as { output: { workspaceRoot: string; path: string } }

      expect(result.output.workspaceRoot).toBe(harness.callerWorkspace)
      expect(existsSync(join(harness.callerWorkspace, 'workspace-note.txt'))).toBe(true)
      expect(existsSync(harness.foreignWorkspace)).toBe(false)
    } finally {
      await harness.service.dispose()
    }
  }, 120_000)


  it('binds a compute + workspace tool with no host service lane at all', async () => {
    // Marketplace composition: no host service providers, no per-plugin client.
    // Before the projection fix this shape was rejected with "DSH ordinary
    // Session invocation envelope is required", which is exactly how map_data
    // became unreachable.
    const harness = await createHarness({ withServices: false })
    try {
      await harness.service.setEnabled(PACKAGE_NAME, true)
      const probe = harness.registry.require('workspace-note.probe')
      expect(probe.descriptor.scope).toBe('workspace')
      await expect(probe.handler(
        { workspaceRoot: harness.foreignWorkspace },
        { caller: { workspaceId: harness.callerWorkspace } } as never
      )).rejects.toThrow(/rejects a workspaceRoot/)
      const result = await probe.handler(
        { workspaceRoot: harness.callerWorkspace },
        { caller: { workspaceId: harness.callerWorkspace } } as never
      ) as { output: { workspaceRoot: string } }
      expect(result.output.workspaceRoot).toBe(harness.callerWorkspace)
    } finally {
      await harness.service.dispose()
    }
  }, 120_000)

  it('leaves an unscoped compute tool argument untouched', async () => {
    const harness = await createHarness()
    try {
      await harness.service.setEnabled(PACKAGE_NAME, true)
      const report = harness.registry.require('workspace-note.report')
      const result = await report.handler(
        { workspaceRoot: harness.foreignWorkspace },
        { caller: { workspaceId: harness.callerWorkspace }, assertPrincipalCurrent: () => {} } as never
      ) as { output: { workspaceRoot: string | null } }
      expect(result.output.workspaceRoot).toBe(harness.foreignWorkspace)
    } finally {
      await harness.service.dispose()
    }
  }, 120_000)

  it('refuses a workspace the Host has not authorized, before any effect starts', async () => {
    const harness = await createHarness({ workspaceAuthorized: false })
    try {
      await harness.service.setEnabled(PACKAGE_NAME, true)
      const write = harness.registry.require('workspace-note.write')
      await expect(write.handler(
        { workspaceRoot: harness.foreignWorkspace, text: 'denied' },
        { caller: { workspaceId: harness.callerWorkspace }, assertPrincipalCurrent: () => {} } as never
      )).rejects.toThrow(/not authorized for workspace/u)
      // The plugin child never received the call, so nothing was written.
      expect(existsSync(join(harness.callerWorkspace, 'workspace-note.txt'))).toBe(false)
      expect(existsSync(harness.foreignWorkspace)).toBe(false)
    } finally {
      await harness.service.dispose()
    }
  }, 120_000)

  it('composes the real workspace authority: a declared workspace outside its roots is refused', async () => {
    const trusted = await mkdtemp(join(await realpath(tmpdir()), 'sciforge-trusted-'))
    try {
      const authority = createWorkspaceAuthority({ readTrustedRoots: () => [trusted] })
      const harness = await createHarness({ authorizeWorkspace: authority })
      try {
        await harness.service.setEnabled(PACKAGE_NAME, true)
        const write = harness.registry.require('workspace-note.write')
        await expect(write.handler(
          { workspaceRoot: harness.foreignWorkspace, text: 'denied' },
          { caller: { workspaceId: harness.callerWorkspace }, assertPrincipalCurrent: () => {} } as never
        )).rejects.toThrow(/not authorized for workspace/u)
        expect(existsSync(join(harness.callerWorkspace, 'workspace-note.txt'))).toBe(false)
      } finally {
        await harness.service.dispose()
      }
    } finally {
      await rm(trusted, { recursive: true, force: true })
    }
  }, 120_000)

  it('removes the bound capability and the rejected scope on unload', async () => {
    const harness = await createHarness()
    try {
      await harness.service.setEnabled(PACKAGE_NAME, true)
      expect(harness.registry.list().map(({ id }) => id)).toContain('workspace-note.write')
      await harness.service.setEnabled(PACKAGE_NAME, false)
      const remaining = harness.registry.list().map(({ id }) => id)
      expect(remaining).not.toContain('workspace-note.write')
      expect(remaining).not.toContain('workspace-note.report')
    } finally {
      await harness.service.dispose()
    }
  }, 120_000)
})

/**
 * The binding itself is a runtime primitive, so a direct SDK consumer (no
 * broker, no Electron) gets the same guarantee as the application path.
 */
describe('workspace binding primitive', () => {
  const readDescriptor = {
    id: 'fixture.read',
    tags: ['dsh-tool', 'dsh-workspace-read'],
    scope: 'resource',
    inputSchema: {
      type: 'object',
      properties: { workspaceRoot: { type: 'string' }, figureVersionId: { type: 'string' } }
    }
  }
  const probeDescriptor = {
    id: 'fixture.status',
    tags: ['dsh-tool', 'dsh-workspace-read'],
    scope: 'resource',
    inputSchema: { type: 'object', properties: {} }
  }

  it('binds a workspace read that declares the argument', () => {
    expect(declaresWorkspaceArgument(readDescriptor)).toBe(true)
    expect(() => bindWorkspaceArgument(readDescriptor, { figureVersionId: 'v1', workspaceRoot: '/foreign' }, '/caller'))
      .toThrow(/rejects a workspaceRoot/)
    expect(bindWorkspaceArgument(readDescriptor, { figureVersionId: 'v1' }, '/caller'))
      .toEqual({ figureVersionId: 'v1', workspaceRoot: '/caller' })
  })

  it('leaves a read probe that declares no argument untouched', () => {
    expect(declaresWorkspaceArgument(probeDescriptor)).toBe(false)
    expect(bindWorkspaceArgument(probeDescriptor, { workspaceRoot: '/foreign' }, '/caller'))
      .toEqual({ workspaceRoot: '/foreign' })
  })

  it('fails closed when a bound tool is invoked without a caller workspace', () => {
    expect(() => bindWorkspaceArgument(readDescriptor, { figureVersionId: 'v1' }, undefined))
      .toThrow(/workspace-scoped caller/u)
  })
})

describe('a workspace-scoped tool without the bound argument never activates', () => {
  async function createBrokenHarness() {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-binding-broken-'))
    temporaryDirectories.push(root)
    const pluginsRoot = join(root, 'plugins')
    const pluginDirectory = join(pluginsRoot, 'workspace-note')
    await mkdir(pluginDirectory, { recursive: true })
    for (const file of ['package.json', 'cordis.patch.yml', 'sciforge.dsh.json', 'build.mjs']) {
      await cp(join(PLUGIN_SOURCE, file), join(pluginDirectory, file))
    }
    await cp(join(PLUGIN_SOURCE, 'src'), join(pluginDirectory, 'src'), { recursive: true })
    // The fixture is outside the workspace, so esbuild must resolve through a link
    // to the repository's installed dependencies.
    await symlink(join(__dirname, '../../..', 'node_modules'), join(pluginDirectory, 'node_modules'), 'dir')
    // Rename the probe's bound argument: the descriptor still claims workspace
    // scope, so activation must reject it instead of running unbound.
    const adapterPath = join(pluginDirectory, 'src', 'dsh-adapter', 'index.ts')
    const { readFile, writeFile } = await import('node:fs/promises')
    const source = await readFile(adapterPath, 'utf8')
    const probeAt = source.indexOf("name: 'workspace_note_probe'")
    const argumentAt = source.indexOf('workspaceRoot: { type: \'string\', required: true }', probeAt)
    expect(argumentAt).toBeGreaterThan(probeAt)
    await writeFile(adapterPath, `${source.slice(0, argumentAt)}label: { type: 'string' }${source.slice(argumentAt + "workspaceRoot: { type: 'string', required: true }".length)}`)
    execFileSync(process.execPath, ['build.mjs'], { cwd: pluginDirectory, stdio: 'pipe' })

    const contract: PluginAdapterContract = {
      hostApiRange: '^1.0.0',
      permissions: [],
      approved: true,
      dshAuthorization: {
        packageName: PACKAGE_NAME,
        packageVersion: PACKAGE_VERSION,
        dshRuntimeVersion: DSH_RUNTIME_VERSION,
        tools: {
          workspace_note_write: { id: 'workspace-note.write', effect: 'workspace-write', scope: 'workspace' },
          workspace_note_probe: { id: 'workspace-note.probe', effect: 'compute', scope: 'workspace' },
          workspace_note_report: { id: 'workspace-note.report', effect: 'compute' }
        }
      }
    } as PluginAdapterContract
    const service = new DevelopmentExternalPluginService({
      // The broken fixture is about activation, not workspace access.
      authorizeWorkspace: () => true,
      root: pluginsRoot,
      userDataPath: join(root, 'data'),
      hostApiVersion: '1.0.0',
      dshRuntimeVersion: DSH_RUNTIME_VERSION,
      adapterContracts: new Map([[PACKAGE_NAME, contract]])
    })
    const registry = new CapabilityRegistry()
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    return { service }
  }

  it('rejects activation with a readable error', async () => {
    const harness = await createBrokenHarness()
    try {
      await expect(harness.service.setEnabled(PACKAGE_NAME, true)).rejects.toThrow(/workspaceRoot/u)
    } finally {
      await harness.service.dispose()
    }
  }, 120_000)
})
