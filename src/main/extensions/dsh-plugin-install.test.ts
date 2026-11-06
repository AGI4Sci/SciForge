import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DomainExtensionSummary } from '../../shared/domain-extensions'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import { assertToolGrantsApproved, installDshPluginArtifact as installReviewedArtifact, type DshPluginInstallRequest, type DshPluginInstallDeps } from './dsh-plugin-install'
import { DSH_PLUGIN_ARTIFACT_MANIFEST_PATH, readDshPluginArtifactBytes, sha256Hex } from './dsh-plugin-artifact'
import JSZip from 'jszip'
import { canonicalJson } from './canonical-json'
import { policyContracts, readDshPluginPolicy } from './dsh-plugin-policy'
// @ts-expect-error The repository packaging CLI is JavaScript without declarations.
import { packDshPlugin, normalizeDeclaration } from '../../../scripts/dsh-plugin-package.mjs'

async function installDshPluginArtifact(deps: DshPluginInstallDeps, request: Omit<DshPluginInstallRequest, 'expectedApproval'>) {
  const bytes = request.artifactBytes!
  const { manifest } = await readDshPluginArtifactBytes(bytes)
  return installReviewedArtifact(deps, { ...request, expectedApproval: {
    packageName: manifest.packageName, version: manifest.version, sha256: sha256Hex(bytes), publisher: null,
    entry: manifest.entry, tools: Object.entries(manifest.tools).map(([name, grant]) => ({ name, ...grant })),
    ports: manifest.ports ?? [], hostDependencies: manifest.hostDependencies
  } })
}

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const packageName = '@sciforge/plugin-port-fixture'
const ports = ['agent-threads.read']
const identity = { packageName, entry: 'dist/main.js' }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-port-approval-'))
  roots.push(root)
  const source = join(root, 'source')
  await mkdir(join(source, 'dist'), { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0', type: 'module', main: './dist/main.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(source, 'dist/main.js'), 'export function apply() {}\n')
  await writeFile(join(source, 'cordis.patch.yml'), '- insert: []\n')
  const pack = async (version = '1.0.0', requested: string[] | null = ports) => {
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: packageName, version, type: 'module', main: './dist/main.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    await writeFile(join(source, 'sciforge.dsh.json'), JSON.stringify({ schemaVersion: 1, packageName, tools: {}, ...(requested === null ? {} : { ports: requested }) }))
    const result = await packDshPlugin({ source, output: join(root, `artifact-${version}.sciforge-dsh-plugin`) })
    return readFile(result.artifact)
  }
  const activate = vi.fn(async (_directory: string, _contract: PluginAdapterContract, _restore: () => Promise<void>) => ({ packageName, version: '1.0.0' }) as DomainExtensionSummary)
  const deps: DshPluginInstallDeps = {
    installedRoot: join(root, 'installed'), stagingRoot: join(root, 'staging'), policyPath: join(root, 'policy.json'),
    dshRuntimeVersion: '0.2.0-rc.2', hostApiRange: '^1.0.0', hostProvidedDependencies: new Set(),
    publisherKeyring: { keys: new Map() }, allowUnsigned: true, supportedPortOperations: new Set(ports),
    service: { installFromDirectory: activate, uninstall: async () => undefined, refreshDiscoveredPlugins: async () => undefined }
  }
  return { root, pack, activate, deps }
}

describe('formal packed Host port approval', () => {
  it('packs bounded declarations without granting them and rejects unapproved/undeclared/unsupported requests before activation', async () => {
    const { pack, activate, deps } = await setup()
    const bytes = await pack()
    expect((await readDshPluginArtifactBytes(bytes)).manifest.ports).toEqual(ports)
    const request = { artifactBytes: bytes, approvedToolNames: [], source: 'test' }
    await expect(installDshPluginArtifact(deps, request)).rejects.toThrow(/unapproved Host port/)
    await expect(installDshPluginArtifact(deps, { ...request, approvedPorts: [] })).rejects.toThrow(/unapproved Host port/)
    await expect(installDshPluginArtifact(deps, { ...request, approvedPorts: [...ports, 'other.read'] })).rejects.toThrow(/not declared/)
    await expect(installDshPluginArtifact({ ...deps, supportedPortOperations: new Set() }, { ...request, approvedPorts: ports })).rejects.toThrow(/does not support/)
    expect(activate).not.toHaveBeenCalled()
    expect((await readDshPluginPolicy(deps.policyPath)).approved).toEqual([])
  })

  it('persists exact approved operations, reloads contracts and restores old grants after invalid updates', async () => {
    const { root, pack, activate, deps } = await setup()
    await installDshPluginArtifact(deps, { artifactBytes: await pack(), approvedToolNames: [], approvedPorts: ports, source: 'test' })
    const saved = await readDshPluginPolicy(deps.policyPath)
    expect(saved.approved[0].ports).toEqual(ports)
    expect(activate.mock.calls[0][1].dshAuthorization?.ports).toEqual(ports)
    const restarted = new DevelopmentExternalPluginService({ root: deps.installedRoot, userDataPath: join(root, 'profile'), hostApiVersion: '1.0.0', dshRuntimeVersion: deps.dshRuntimeVersion, adapterContracts: policyContracts(saved) })
    expect(restarted.approvedHostServicePorts(packageName, '1.0.0')).toEqual(ports)
    expect(restarted.approvedHostServicePorts(packageName, '1.0.1')).toBeUndefined()
    await expect(installDshPluginArtifact(deps, { artifactBytes: await pack('1.0.1', [...ports, 'other.read']), approvedToolNames: [], approvedPorts: ports, source: 'test' })).rejects.toThrow(/unapproved Host port/)
    activate.mockImplementationOnce(async (_directory, _contract, restore) => { await restore(); throw new Error('activation rejected') })
    await expect(installDshPluginArtifact(deps, { artifactBytes: await pack('1.0.2'), approvedToolNames: [], approvedPorts: ports, source: 'test' })).rejects.toThrow(/activation rejected/)
    expect(await readDshPluginPolicy(deps.policyPath)).toEqual(saved)
    expect((await readDshPluginArtifactBytes(await pack())).manifest.version).toBe('1.0.0')
    await restarted.dispose()
  })

  it('preserves old artifacts without ports and never grants an undeclared approval', async () => {
    const { pack, deps } = await setup()
    const bytes = await pack('1.0.0', null)
    expect((await readDshPluginArtifactBytes(bytes)).manifest).not.toHaveProperty('ports')
    await expect(installDshPluginArtifact(deps, { artifactBytes: bytes, approvedToolNames: [], approvedPorts: ports, source: 'test' })).rejects.toThrow(/not declared/)
    await installDshPluginArtifact(deps, { artifactBytes: bytes, approvedToolNames: [], source: 'test' })
    const entry = (await readDshPluginPolicy(deps.policyPath)).approved[0]
    expect(entry).not.toHaveProperty('ports')
    expect(policyContracts(await readDshPluginPolicy(deps.policyPath)).get(`${packageName}@1.0.0`)?.dshAuthorization).not.toHaveProperty('ports')
  })

  it.each([null, 'agent-threads.read', [' agent-threads.read'], ['unknown'], ['Agent.read'], ['a.'.repeat(70)], Array.from({ length: 65 }, (_, n) => `service.read-${n}`), [...ports, ...ports]])('rejects malformed declaration ports %#', input => {
    expect(() => normalizeDeclaration({ schemaVersion: 1, packageName, ports: input }, identity)).toThrow(/port/)
  })
})

async function artifact() {
  const packageName = '@sciforge/plugin-port-fixture'
  const payload = {
    'package.json': Buffer.from(JSON.stringify({ name: packageName, version: '1.0.0', main: 'dist/main.js', dsh: { bundle: {} } })),
    'dist/main.js': Buffer.from('export function apply() {}'),
    'sciforge.dsh.json': Buffer.from(JSON.stringify({ schemaVersion: 1, packageName, ports: ['view.list'] }))
  }
  const manifest = { schemaVersion: 1, packageName, version: '1.0.0', entry: 'dist/main.js', dsh: { bundle: {} },
    hostDependencies: [], ports: ['view.list'], tools: {}, files: Object.fromEntries(Object.entries(payload).map(([path, bytes]) => [path, sha256Hex(bytes)])) }
  const zip = new JSZip()
  for (const [path, bytes] of Object.entries(payload)) zip.file(path, bytes)
  zip.file(DSH_PLUGIN_ARTIFACT_MANIFEST_PATH, canonicalJson(manifest))
  return zip.generateAsync({ type: 'nodebuffer' })
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-port-install-')); roots.push(root)
  const install = vi.fn<DshPluginInstallDeps['service']['installFromDirectory']>(async () => ({ packageName: '@sciforge/plugin-port-fixture' }) as never)
  const deps = { installedRoot: join(root, 'installed'), stagingRoot: join(root, 'staging'), policyPath: join(root, 'policy.json'),
    dshRuntimeVersion: '0.2.0-rc.2', hostApiRange: '^1', hostProvidedDependencies: new Set<string>(),
    publisherKeyring: new Map(), allowUnsigned: true,
    service: { installFromDirectory: install, uninstall: vi.fn(), refreshDiscoveredPlugins: vi.fn() }
  } as unknown as DshPluginInstallDeps
  return { deps, install }
}

describe('installation port approval boundary', () => {
  it('refuses same-name grants whose reviewed effect or scope is different', async () => {
    const { manifest } = await readDshPluginArtifactBytes(await artifact())
    const actual = { ...manifest, tools: { list: { id: 'view.list', effect: 'destructive' as const, scope: 'workspace' as const, approval: 'confirmation' as const } } }
    expect(() => assertToolGrantsApproved(actual, [{ name: 'list', id: 'view.list', effect: 'read' }])).toThrow(/complete tool grants differ/)
    expect(() => assertToolGrantsApproved(actual, [{ name: 'list', id: 'view.list', effect: 'destructive', approval: 'confirmation' }])).toThrow(/complete tool grants differ/)
  })
  it('does not infer approval from a digest-verified request or approved tool list', async () => {
    const { deps, install } = await fixture()
    const artifactBytes = await artifact()
    await expect(installDshPluginArtifact(deps, { artifactBytes, approvedToolNames: [], source: 'test' })).rejects.toThrow(/unapproved Host port/)
    await expect(installDshPluginArtifact(deps, { artifactBytes, approvedToolNames: [], approvedPorts: ['view.list', 'view.capture'], source: 'test' })).rejects.toThrow(/not declared/)
    expect(install).not.toHaveBeenCalled()
    await expect(readFile(deps.policyPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists declared and approved ports separately and restores exact-version grants', async () => {
    const { deps, install } = await fixture()
    await installDshPluginArtifact(deps, { artifactBytes: await artifact(), approvedToolNames: [], approvedPorts: ['view.list'], source: 'Host review' })
    const policy = await readDshPluginPolicy(deps.policyPath)
    expect(policy.approved[0].declaredPorts).toEqual(['view.list'])
    expect(policy.approved[0].ports).toEqual(['view.list'])
    expect(install.mock.calls[0]?.[1]).toMatchObject({ dshAuthorization: { ports: ['view.list'] } })
    const contract = policyContracts(policy).get('@sciforge/plugin-port-fixture@1.0.0')
    expect(contract?.dshAuthorization?.ports).toEqual(['view.list'])
  })
})
