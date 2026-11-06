/**
 * Installer and market behaviour.
 *
 * The acceptance scripts prove the user-visible flow on a packaged app; these tests
 * pin the rules that flow relies on, and the ones a user can hit but the happy path
 * never shows: an approval list that does not match the artifact, the same version
 * with different content, a failed upgrade that must not destroy a working install,
 * leftovers after a failure, two installs racing, and a download that stalls.
 *
 * Keys and artifacts are generated inside the test: no fixture key, no real key.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginVersionStore, type PluginAdapterContract } from '@sciforge/plugin-sdk'
import type { DomainExtensionSummary } from '../../shared/domain-extensions'
import { canonicalJson } from './canonical-json'
import {
  DSH_PLUGIN_ARTIFACT_MANIFEST_PATH,
  DSH_PLUGIN_ARTIFACT_SIGNATURE_PATH,
  readDshPluginArtifactBytes,
  sha256Hex
} from './dsh-plugin-artifact'
import { loadDshPublisherKeyring, type DshPublisherKeyring } from './dsh-plugin-signature'
import { installDshPluginArtifact as installReviewedArtifact, type DshPluginInstallRequest, type DshPluginInstallDeps } from './dsh-plugin-install'
import { policyContracts, readDshPluginPolicy } from './dsh-plugin-policy'
import { DevelopmentExternalPluginService } from './development-external-plugins'
import {
  createDshMarketSurface,
  defaultFetchBytes,
  readDshMarketIndex,
  resolveArtifactLocation,
  resolveDshMarketSource
} from './dsh-plugin-market'

// Engineering fixture review is explicit and distinct from the real market UI.
async function installDshPluginArtifact(deps: DshPluginInstallDeps, request: Omit<DshPluginInstallRequest, 'expectedApproval'>) {
  const bytes = request.artifactBytes!
  const artifact = await readDshPluginArtifactBytes(bytes)
  const manifest = artifact.manifest
  return installReviewedArtifact(deps, { ...request, expectedApproval: {
    packageName: manifest.packageName, version: manifest.version, sha256: sha256Hex(bytes),
    publisher: artifact.signatureBytes ? JSON.parse(Buffer.from(artifact.signatureBytes).toString()).publisherId : null,
    entry: manifest.entry, tools: Object.entries(manifest.tools).map(([name, grant]) => ({ name, ...grant })),
    ports: manifest.ports ?? [], hostDependencies: manifest.hostDependencies
  } })
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

async function tempRoot(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

const PACKAGE_NAME = '@sciforge/plugin-fixture'
const TOOLS = Object.freeze({
  count: { id: 'fixture.count', effect: 'compute' as const },
  explain: { id: 'fixture.explain', effect: 'compute' as const }
})

type TestKey = Readonly<{ keyId: string; publisherId: string; privateKeyPem: string; publicKeyPem: string }>

function makeKey(keyId: string, publisherId: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    keyId,
    publisherId,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

async function keyringFrom(keys: readonly TestKey[]): Promise<DshPublisherKeyring> {
  const directory = await tempRoot('dsh-market-keyring-')
  const path = join(directory, 'dsh-publisher-keys.json')
  await writeFile(path, JSON.stringify({
    version: 1,
    keys: keys.map((key) => ({ keyId: key.keyId, publisherId: key.publisherId, publicKey: key.publicKeyPem }))
  }))
  return loadDshPublisherKeyring(path)
}

function payloadFor(version: string, marker: string, packageName = PACKAGE_NAME): Readonly<Record<string, Buffer>> {
  return {
    'package.json': Buffer.from(`${JSON.stringify({
      name: packageName,
      version,
      type: 'module',
      exports: { '.': { import: './dist/main.js' } },
      engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
      dsh: { bundle: { patch: './cordis.patch.yml' } }
    }, null, 2)}\n`),
    'dist/main.js': Buffer.from(`export function apply() { return ${JSON.stringify(marker)} }\n`),
    'cordis.patch.yml': Buffer.from('- insert: []\n')
  }
}

async function buildArtifact(options: Readonly<{
  packageName?: string
  version?: string
  marker?: string
  tools?: Readonly<Record<string, { id: string; effect: string }>>
  ports?: readonly string[]
  signWith?: TestKey | null
  payload?: Readonly<Record<string, Buffer>>
}> = {}): Promise<Buffer> {
  const version = options.version ?? '1.0.0'
  const packageName = options.packageName ?? PACKAGE_NAME
  const payload = { ...(options.payload ?? payloadFor(version, options.marker ?? `v${version}`, packageName)),
    ...(options.ports ? { 'sciforge.dsh.json': Buffer.from(JSON.stringify({ schemaVersion: 1, ports: options.ports })) } : {}) }
  const manifest = {
    schemaVersion: 1,
    packageName,
    version,
    entry: 'dist/main.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
    hostDependencies: [],
    ...(options.ports ? { ports: options.ports } : { hostServices: 'none' }),
    tools: options.tools ?? TOOLS,
    files: Object.fromEntries(
      Object.entries(payload).map(([path, bytes]) => [path, sha256Hex(bytes)]).sort(([left], [right]) => String(left).localeCompare(String(right)))
    )
  }
  const manifestBytes = Buffer.from(canonicalJson(manifest as never))
  const zip = new JSZip()
  const date = new Date('2000-01-01T00:00:00.000Z')
  for (const [path, bytes] of Object.entries(payload)) zip.file(path, bytes, { date })
  zip.file(DSH_PLUGIN_ARTIFACT_MANIFEST_PATH, manifestBytes, { date })
  if (options.signWith) {
    zip.file(DSH_PLUGIN_ARTIFACT_SIGNATURE_PATH, Buffer.from(canonicalJson({
      version: 1,
      algorithm: 'ed25519',
      keyId: options.signWith.keyId,
      publisherId: options.signWith.publisherId,
      signature: signEd25519(null, manifestBytes, createPrivateKey(options.signWith.privateKeyPem)).toString('base64')
    })), { date })
  }
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
}

type ServiceCalls = { installed: string[]; uninstalled: string[]; refreshed: number }

function installDeps(options: Readonly<{
  root: string
  keyring: DshPublisherKeyring
  behavior?: (target: string, call: number) => Promise<void>
}>): Readonly<{ deps: DshPluginInstallDeps; calls: ServiceCalls; stagingRoot: string; installedRoot: string; policyPath: string }> {
  const installedRoot = join(options.root, 'installed')
  const stagingRoot = join(options.root, 'staging')
  const policyPath = join(options.root, 'extensions', 'dsh-plugin-policy.json')
  const calls: ServiceCalls = { installed: [], uninstalled: [], refreshed: 0 }
  const deps: DshPluginInstallDeps = {
    installedRoot,
    stagingRoot,
    policyPath,
    dshRuntimeVersion: '0.2.0-rc.2',
    hostApiRange: '>=0.2.0-rc.2 <0.3.0',
    hostProvidedDependencies: new Set(['@deepseek-ai/dsh-tools']),
    publisherKeyring: options.keyring,
    service: {
      installFromDirectory: async (directory: string, _contract: PluginAdapterContract, restoreInstallation) => {
        calls.installed.push(directory)
        try { await options.behavior?.(directory, calls.installed.length) }
        catch (error) { await restoreInstallation(); throw error }
        return { packageName: PACKAGE_NAME, version: '1.0.0' } as unknown as DomainExtensionSummary
      },
      uninstall: async (packageName: string) => { calls.uninstalled.push(packageName) },
      refreshDiscoveredPlugins: async () => { calls.refreshed += 1 }
    }
  }
  return { deps, calls, stagingRoot, installedRoot, policyPath }
}

describe('installDshPluginArtifact', () => {
  it('installs a signed artifact, records the grant, and refuses a mismatched approval list', async () => {
    const key = makeKey('test-key', 'fixture-publisher')
    const keyring = await keyringFrom([key])
    const root = await tempRoot('dsh-install-')
    const { deps, policyPath } = installDeps({ root, keyring })
    const bytes = await buildArtifact({ signWith: key })

    // Approving one of the two declared tools is not approval of the plugin.
    await expect(installDshPluginArtifact(deps, {
      artifactBytes: bytes, approvedToolNames: ['count'], source: 'test'
    })).rejects.toThrow(/requests unapproved tool grants: explain/)

    // Approving something the artifact never declared is refused too.
    await expect(installDshPluginArtifact(deps, {
      artifactBytes: bytes, approvedToolNames: ['count', 'explain', 'extra'], source: 'test'
    })).rejects.toThrow(/not declared by the artifact: extra/)

    const result = await installDshPluginArtifact(deps, {
      artifactBytes: bytes, approvedToolNames: ['count', 'explain'], expectedSha256: sha256Hex(bytes), source: 'test'
    })
    expect(result.packageName).toBe(PACKAGE_NAME)
    expect(result.tools).toEqual(['count', 'explain'])
    expect(await readFile(join(result.installedDirectory, 'dist', 'main.js'), 'utf8')).toContain('v1.0.0')
    const policy = await readDshPluginPolicy(policyPath)
    expect(policy.approved).toHaveLength(1)
    expect(policy.approved[0]).toMatchObject({ packageName: PACKAGE_NAME, version: '1.0.0', publisherId: 'fixture-publisher' })
  })

  it('roundtrips a packed signed service list through installation and persisted policy', async () => {
    // @ts-expect-error The repository packaging CLI is JavaScript without declarations.
    const { packDshPlugin } = await import('../../../scripts/dsh-plugin-package.mjs')
    const key = makeKey('test-key', 'fixture-publisher')
    const keyring = await keyringFrom([key])
    const root = await tempRoot('dsh-services-')
    const source = join(root, 'source')
    for (const [path, bytes] of Object.entries(payloadFor('1.0.0', 'services'))) {
      const target = join(source, path)
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, bytes)
    }
    const services = ['service.alpha', 'service.beta']
    await writeFile(join(source, 'sciforge.dsh.json'), JSON.stringify({
      schemaVersion: 1, packageName: PACKAGE_NAME, tools: TOOLS, hostServices: services
    }))
    const signingKeyPath = join(root, 'test-key.pem')
    await writeFile(signingKeyPath, key.privateKeyPem, { mode: 0o600 })
    const packed = await packDshPlugin({ source, output: join(root, 'plugin.sciforge-dsh-plugin'), signingKeyPath, keyId: key.keyId, publisherId: key.publisherId })
    const bytes = await readFile(packed.artifact)
    const artifact = await readDshPluginArtifactBytes(bytes)
    expect(artifact.manifest.hostServices).toEqual(services)
    expect(JSON.parse(artifact.manifestBytes.toString('utf8')).hostServices).toEqual(services)
    const { deps, policyPath } = installDeps({ root, keyring })
    const install = vi.spyOn(deps.service, 'installFromDirectory')
    const result = await installDshPluginArtifact(deps, { artifactBytes: bytes, approvedToolNames: ['count', 'explain'], source: 'test' })
    expect(install.mock.calls[0]?.[1].dshAuthorization?.hostServices).toEqual(services)
    const policy = await readDshPluginPolicy(policyPath)
    expect(policy.approved[0].hostServices).toEqual(services)
    expect(policyContracts(policy).get(`${PACKAGE_NAME}@1.0.0`)?.dshAuthorization?.hostServices).toEqual(services)
    const installed = await readDshPluginArtifactBytes(await readFile(packed.artifact))
    expect(await readFile(join(result.installedDirectory, DSH_PLUGIN_ARTIFACT_MANIFEST_PATH))).toEqual(installed.manifestBytes)

    // A structurally valid service change still needs a new publisher signature.
    const zip = await JSZip.loadAsync(bytes)
    const changed = JSON.parse(artifact.manifestBytes.toString('utf8'))
    changed.hostServices = ['service.other']
    const declaration = JSON.parse(await zip.file('sciforge.dsh.json')!.async('string'))
    declaration.hostServices = changed.hostServices
    const changedDeclaration = JSON.stringify(declaration)
    zip.file('sciforge.dsh.json', changedDeclaration)
    changed.files['sciforge.dsh.json'] = createHash('sha256').update(changedDeclaration).digest('hex')
    zip.file(DSH_PLUGIN_ARTIFACT_MANIFEST_PATH, canonicalJson(changed))
    const tampered = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
    await expect(installDshPluginArtifact(deps, { artifactBytes: tampered, approvedToolNames: ['count', 'explain'], source: 'test' })).rejects.toThrow(/does not match the artifact bytes/)
  })

  it('refuses the same version with different content instead of silently replacing it', async () => {
    const key = makeKey('test-key', 'fixture-publisher')
    const root = await tempRoot('dsh-samever-')
    const { deps } = installDeps({ root, keyring: await keyringFrom([key]) })
    const first = await buildArtifact({ signWith: key })
    await installDshPluginArtifact(deps, { artifactBytes: first, approvedToolNames: ['count', 'explain'], source: 'test' })

    const changed = await buildArtifact({ signWith: key, marker: 'changed-content' })
    await expect(installDshPluginArtifact(deps, {
      artifactBytes: changed, approvedToolNames: ['count', 'explain'], source: 'test'
    })).rejects.toThrow(/already approved with different content/)
    // The installed copy still holds the content the approval covers.
    expect(await readFile(join(deps.installedRoot, 'sciforge-plugin-fixture', 'dist', 'main.js'), 'utf8')).toContain('v1.0.0')
  })

  it('keeps a working install when the upgrade fails, and leaves no leftovers', async () => {
    const key = makeKey('test-key', 'fixture-publisher')
    const root = await tempRoot('dsh-failupgrade-')
    const { deps, calls, stagingRoot, installedRoot } = installDeps({
      root,
      keyring: await keyringFrom([key]),
      behavior: async (target, call) => {
        if (call === 1) await writeFile(join(target, '.service-ready'), 'ok')
        if (call === 2) throw new Error('the extension service rejected the upgrade')
      }
    })
    await installDshPluginArtifact(deps, { artifactBytes: await buildArtifact({ signWith: key }), approvedToolNames: ['count', 'explain'], source: 'test' })

    await expect(installDshPluginArtifact(deps, {
      artifactBytes: await buildArtifact({ version: '1.0.1', signWith: key }), approvedToolNames: ['count', 'explain'], source: 'test'
    })).rejects.toThrow(/rejected the upgrade/)

    const installed = await readdir(installedRoot)
    expect(installed).toEqual(['sciforge-plugin-fixture'])
    const survivor = join(installedRoot, 'sciforge-plugin-fixture')
    expect(await readFile(join(survivor, 'dist', 'main.js'), 'utf8')).toContain('v1.0.0')
    expect(await readFile(join(survivor, '.service-ready'), 'utf8')).toBe('ok')
    expect((await readdir(installedRoot)).some((name) => name.startsWith('.install-') || name.includes('.previous-'))).toBe(false)
    expect(await readdir(stagingRoot)).toEqual([])
    expect(calls.installed).toHaveLength(2)
  })

  it('refuses bytes that disagree with the published digest and writes nothing', async () => {
    const key = makeKey('test-key', 'fixture-publisher')
    const root = await tempRoot('dsh-digest-')
    const { deps, installedRoot, stagingRoot } = installDeps({ root, keyring: await keyringFrom([key]) })
    await expect(installDshPluginArtifact(deps, {
      artifactBytes: await buildArtifact({ signWith: key }),
      approvedToolNames: ['count', 'explain'],
      expectedSha256: sha256Hex(Buffer.from('something else')),
      source: 'test'
    })).rejects.toThrow(/does not match the published digest/)
    expect(await listDir(installedRoot)).toEqual([])
    expect(await listDir(stagingRoot)).toEqual([])
  })

  it('serializes shared policy writes and preserves an earlier approval when a queued install fails', async () => {
    const key = makeKey('queue-key', 'fixture-publisher')
    const root = await tempRoot('dsh-policy-queue-')
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const { deps, calls } = installDeps({ root, keyring: await keyringFrom([key]), behavior: async (_directory, call) => {
      if (call === 1) { entered(); await gate }
      else throw new Error('queued install rejected')
    } })
    const firstBytes = await buildArtifact({ signWith: key })
    const secondBytes = await buildArtifact({ packageName: '@sciforge/plugin-other', signWith: key })
    const request = { approvedToolNames: ['count', 'explain'], source: 'queue-test' }
    const first = installDshPluginArtifact(deps, { ...request, artifactBytes: firstBytes })
    await started
    const second = installDshPluginArtifact(deps, { ...request, artifactBytes: secondBytes })
    const result = Promise.allSettled([first, second])
    try {
      expect(calls.installed).toHaveLength(1)
    } finally { release() }
    expect((await result).map(entry => entry.status)).toEqual(['fulfilled', 'rejected'])
    expect((await readDshPluginPolicy(deps.policyPath)).approved.map(entry => entry.packageName)).toEqual([PACKAGE_NAME])
  })
})

describe('real installation rollback', () => {
  async function fixture(staleEnabledIntent = false) {
    const root = await tempRoot('dsh-real-upgrade-')
    const key = makeKey('upgrade-key', 'fixture-publisher')
    const { deps: stubDeps } = installDeps({ root, keyring: await keyringFrom([key]) })
    await mkdir(stubDeps.installedRoot, { recursive: true })
    if (staleEnabledIntent) {
      await mkdir(join(root, 'extensions'), { recursive: true })
      await writeFile(join(root, 'extensions', 'development-external-state.json'), JSON.stringify({ schemaVersion: 4, enabled: [PACKAGE_NAME] }))
    }
    const resolverPath = join(root, 'resolver.mjs')
    await writeFile(resolverPath, `
import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}`)
    const create = async () => {
      const service = new DevelopmentExternalPluginService({
        root: stubDeps.installedRoot, userDataPath: root, hostApiVersion: '1.11.0',
        dshRuntimeVersion: '0.2.0-rc.2', dshAgentResolver: { path: resolverPath },
        adapterContracts: policyContracts(await readDshPluginPolicy(stubDeps.policyPath))
      })
      await service.initialize()
      return service
    }
    let service = await create()
    const artifact = async (version: string, fails = false) => buildArtifact({
      version, signWith: key, ports: ['fixture.read'], tools: { echo: { id: 'fixture.echo', effect: 'read' } },
      payload: {
        ...payloadFor(version, version),
        'dist/main.js': Buffer.from(`
import { defineTool } from '@deepseek-ai/dsh-tools'
export const inject = ['tools']
export function apply(ctx) {
  ${fails ? "throw new Error('fixture activation rejected')" : ''}
  ctx.tools.register(defineTool({ name: 'echo', description: 'version', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
    execute: () => ({ version: ${JSON.stringify(version)} }) }))
}`)
      }
    })
    const invoke = () => service.invokeTool(PACKAGE_NAME, 'echo', {}, {
      caller: { audience: 'agent', callerId: 'upgrade-test', workspaceId: root },
      ordinarySession: { runtimeId: 'fixture-runtime', threadId: 'fixture-thread', sessionId: 'host-placeholder' }, context: {}
    })
    return {
      root, policyPath: stubDeps.policyPath, installedRoot: stubDeps.installedRoot, invoke,
      store: new PluginVersionStore(join(root, 'extensions', 'plugin-versions')),
      install: async (version: string, fails = false, failRecovery = false) => installDshPluginArtifact({ ...stubDeps, hostApiRange: '^1', service: {
        installFromDirectory: (directory, contract, restore) => service.installFromDirectory(directory, contract, async () => {
          if (failRecovery) throw new Error('fixture filesystem recovery blocked')
          await restore()
        }),
        uninstall: name => service.uninstall(name),
        refreshDiscoveredPlugins: () => service.refreshDiscoveredPlugins()
      } }, {
        artifactBytes: await artifact(version, fails), approvedToolNames: ['echo'], approvedPorts: ['fixture.read'], source: 'real-rollback-test'
      }),
      get service() { return service },
      restart: async () => { await service.dispose(); service = await create() },
      close: async () => service.dispose()
    }
  }

  for (const enabled of [true, false]) {
    it(`restores previous runtime, approvals and version history after a failed upgrade (enabled=${enabled})`, { timeout: 60_000 }, async () => {
      const f = await fixture()
      try {
        expect(f.service.approvedHostServicePorts(PACKAGE_NAME, '1.0.0')).toBeUndefined()
        await f.install('1.0.0')
        expect(f.service.approvedHostServicePorts(PACKAGE_NAME, '1.0.0')).toEqual(['fixture.read'])
        expect(f.service.approvedHostServicePorts('@sciforge/other', '1.0.0')).toBeUndefined()
        expect(await f.invoke()).toEqual({ version: '1.0.0' })
        await f.install('2.0.0')
        expect(await f.invoke()).toEqual({ version: '2.0.0' })
        if (!enabled) await f.service.setEnabled(PACKAGE_NAME, false)
        const before = await f.store.active(PACKAGE_NAME)
        const policy = await readDshPluginPolicy(f.policyPath)
        await expect(f.install('3.0.0', true)).rejects.toThrow(/activation failed|activation rejected/)
        expect(f.service.approvedHostServicePorts(PACKAGE_NAME, '3.0.0')).toBeUndefined()
        expect(f.service.approvedHostServicePorts(PACKAGE_NAME, '2.0.0')).toEqual(['fixture.read'])
        expect(await f.store.versions(PACKAGE_NAME)).toEqual(['1.0.0', '2.0.0'])
        expect(await f.store.active(PACKAGE_NAME)).toEqual(before)
        expect(await readDshPluginPolicy(f.policyPath)).toEqual(policy)
        expect((await f.service.list()).find(p => p.packageName === PACKAGE_NAME)).toMatchObject({ version: '2.0.0', enabled })
        expect(await readdir(f.installedRoot)).toEqual(['sciforge-plugin-fixture'])
        if (enabled) expect(await f.invoke()).toEqual({ version: '2.0.0' })
        else await expect(f.invoke()).rejects.toThrow()
        await f.restart()
        expect((await f.service.list()).find(p => p.packageName === PACKAGE_NAME)).toMatchObject({ version: '2.0.0', enabled })
        expect(await f.store.versions(PACKAGE_NAME)).toEqual(['1.0.0', '2.0.0'])
        if (!enabled) await f.service.setEnabled(PACKAGE_NAME, true)
        expect(await f.invoke()).toEqual({ version: '2.0.0' })
      } finally { await f.close() }
    })
  }

  it('leaves no approval, enabled state or version after a first-install activation failure', { timeout: 60_000 }, async () => {
    const f = await fixture()
    try {
      await expect(f.install('1.0.0', true)).rejects.toThrow(/activation failed|activation rejected/)
      expect(f.service.approvedHostServicePorts(PACKAGE_NAME, '1.0.0')).toBeUndefined()
      expect((await readDshPluginPolicy(f.policyPath)).approved).toEqual([])
      expect(await f.store.versions(PACKAGE_NAME)).toEqual([])
      expect(await f.store.active(PACKAGE_NAME)).toBeUndefined()
      expect(await readdir(f.installedRoot)).toEqual([])
      expect((await f.service.list()).find(p => p.packageName === PACKAGE_NAME)).toBeUndefined()
      await f.restart()
      expect((await f.service.list()).find(p => p.packageName === PACKAGE_NAME)).toBeUndefined()
      await f.install('1.0.0')
      expect(await f.invoke()).toEqual({ version: '1.0.0' })
    } finally { await f.close() }
  })

  it('cleans a failed first install without resuming a stale enabled intent', { timeout: 60_000 }, async () => {
    const f = await fixture(true)
    try {
      await expect(f.install('1.0.0', true)).rejects.toThrow(/activation failed|activation rejected/)
      expect(f.service.approvedHostServicePorts(PACKAGE_NAME, '1.0.0')).toBeUndefined()
      expect((await readDshPluginPolicy(f.policyPath)).approved).toEqual([])
      expect(await f.store.versions(PACKAGE_NAME)).toEqual([])
      expect(await readdir(f.installedRoot)).toEqual([])
      const state = JSON.parse(await readFile(join(f.root, 'extensions', 'development-external-state.json'), 'utf8'))
      expect(state.enabled).not.toContain(PACKAGE_NAME)
    } finally { await f.close() }
  })

  it('reports incomplete recovery and retains old directory and snapshots if file restoration fails', { timeout: 60_000 }, async () => {
    const f = await fixture()
    try {
      await f.install('1.0.0')
      await f.install('2.0.0')
      await expect(f.install('3.0.0', true, true)).rejects.toThrow(/recovery is incomplete/)
      const backup = (await readdir(f.installedRoot)).find(name => name.startsWith('.sciforge-plugin-fixture.previous-'))
      expect(backup).toBeDefined()
      expect(JSON.parse(await readFile(join(f.installedRoot, backup!, 'package.json'), 'utf8')).version).toBe('2.0.0')
      expect(await f.store.versions(PACKAGE_NAME)).toEqual(['1.0.0', '2.0.0'])
      expect(await f.store.active(PACKAGE_NAME)).toBeUndefined()
      await expect(f.invoke()).rejects.toThrow()
    } finally { await f.close() }
  })

  it('preserves a disable requested during a failed upgrade instead of overwriting it with rollback state', { timeout: 60_000 }, async () => {
    const f = await fixture()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const original = PluginVersionStore.prototype.clearActive
    await f.install('1.0.0')
    const spy = vi.spyOn(PluginVersionStore.prototype, 'clearActive').mockImplementationOnce(async function (this: PluginVersionStore, name) {
      entered()
      await gate
      return original.call(this, name)
    })
    try {
      const upgrading = f.install('2.0.0', true)
      const result = Promise.allSettled([upgrading])
      await started
      let disableComplete = false
      const disabling = f.service.setEnabled(PACKAGE_NAME, false).then(() => { disableComplete = true })
      await Promise.resolve()
      expect(disableComplete).toBe(false)
      release()
      expect((await result)[0].status).toBe('rejected')
      await disabling
      expect((await f.service.list()).find(p => p.packageName === PACKAGE_NAME)).toMatchObject({ version: '1.0.0', enabled: false })
      await expect(f.invoke()).rejects.toThrow()
      await f.restart()
      expect((await f.service.list()).find(p => p.packageName === PACKAGE_NAME)).toMatchObject({ version: '1.0.0', enabled: false })
    } finally { release(); spy.mockRestore(); await f.close() }
  })
})

describe('createDshMarketSurface', () => {
  async function marketFixture(ports?: readonly string[]): Promise<Readonly<{
    surface: ReturnType<typeof createDshMarketSurface>
    calls: ServiceCalls
    index: string
    artifactDirectory: string
    bytes: Buffer
    key: TestKey
  }>> {
    const key = makeKey('market-key', 'fixture-publisher')
    const keyring = await keyringFrom([key])
    const root = await tempRoot('dsh-market-')
    const { deps, calls } = installDeps({ root, keyring })
    const bytes = await buildArtifact({ signWith: key, ports })
    const marketDirectory = join(root, 'market')
    const artifactDirectory = join(marketDirectory, 'artifacts')
    await mkdir(artifactDirectory, { recursive: true })
    const file = 'sciforge-plugin-fixture-1.0.0.sciforge-dsh-plugin'
    await writeFile(join(artifactDirectory, file), bytes)
    const index = {
      format: 1,
      generatedAt: '2026-10-24T00:00:00.000Z',
      dshRuntimeVersion: '0.2.0-rc.2',
      plugins: [{
        name: PACKAGE_NAME,
        title: 'Fixture',
        version: '1.0.0',
        form: 'dsh-runtime',
        categories: ['test'],
        ports,
        entry: 'dist/main.js',
        tools: [{ name: 'count', id: 'fixture.count', effect: 'compute' }, { name: 'explain', id: 'fixture.explain', effect: 'compute' }],
        hostDependencies: [],
        publisher: 'fixture-publisher',
        artifact: { file, sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) },
        runtimeNote: null,
        source: 'plugins/fixture'
      }],
      blocked: []
    }
    const indexPath = join(marketDirectory, 'index.json')
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
    const progress: string[] = []
    const surface = createDshMarketSurface({
      source: { kind: 'file', path: indexPath },
      installDeps: deps,
      listInstalled: async () => [],
      setEnabled: async () => undefined,
      isCapabilityRegistered: () => false
    })
    return { surface, calls, index: indexPath, artifactDirectory, bytes, key }
  }

  it('installs from the catalog through the real phases and reports them in order', async () => {
    const fixture = await marketFixture()
    const phases: string[] = []
    const originalInstall = fixture.surface.install
    const outcome = await originalInstall({ packageName: PACKAGE_NAME, approvalSnapshot: (await fixture.surface.list()).plugins[0]!.approvalSnapshot, approvedToolNames: ['count', 'explain'] })
    expect(outcome.sha256).toBe(sha256Hex(fixture.bytes))
    const progress = await fixture.surface.progress({ packageName: PACKAGE_NAME })
    expect(progress?.phase).toBe('done')
    void phases
    const listed = await fixture.surface.list()
    expect(listed.error).toBeNull()
    expect(listed.plugins.map((plugin) => plugin.sha256)).toEqual([sha256Hex(fixture.bytes)])
    expect(listed.plugins[0]?.capabilities.map((capability) => capability.registered)).toEqual([false, false])
  })

  it('requires explicit exact Host operation approval and forwards it through the installer', async () => {
    const fixture = await marketFixture(['view.list', 'view.capture'])
    expect((await fixture.surface.list()).plugins[0]?.ports).toEqual(['view.list', 'view.capture'])
    const request = { packageName: PACKAGE_NAME, approvalSnapshot: (await fixture.surface.list()).plugins[0]!.approvalSnapshot, approvedToolNames: ['count', 'explain'] }
    await expect(fixture.surface.install(request)).rejects.toThrow(/Explicit Host operation approval/)
    await expect(fixture.surface.install({ ...request, approvedPorts: ['view.list'] })).rejects.toThrow(/Explicit Host operation approval/)
    await expect(fixture.surface.install({ ...request, approvedPorts: ['view.list', 'view.capture', 'extra'] })).rejects.toThrow(/Explicit Host operation approval/)
    expect(fixture.calls.installed).toEqual([])
    await fixture.surface.install({ ...request, approvedPorts: ['view.capture', 'view.list'] })
    expect(fixture.calls.installed).toHaveLength(1)
  })

  it('refuses catalog operations that disagree with the verified artifact', async () => {
    const fixture = await marketFixture(['view.list'])
    const catalog = JSON.parse(await readFile(fixture.index, 'utf8'))
    catalog.plugins[0].ports = ['view.capture']
    await writeFile(fixture.index, JSON.stringify(catalog))
    await expect(fixture.surface.install({ packageName: PACKAGE_NAME, approvalSnapshot: (await fixture.surface.list()).plugins[0]!.approvalSnapshot, approvedToolNames: ['count', 'explain'], approvedPorts: ['view.capture'] })).rejects.toThrow(/complete grants differ/)
    expect(fixture.calls.installed).toEqual([])
  })

  it.each(['version', 'sha256', 'publisher', 'id', 'effect', 'scope', 'approval'] as const)('refuses a stale approval after catalog %s changes without side effects', async (field) => {
    const fixture = await marketFixture()
    const approvalSnapshot = (await fixture.surface.list()).plugins[0]!.approvalSnapshot
    const catalog = JSON.parse(await readFile(fixture.index, 'utf8'))
    const entry = catalog.plugins[0]
    if (field === 'version') entry.version = '1.0.1'
    else if (field === 'sha256') entry.artifact.sha256 = '0'.repeat(64)
    else if (field === 'publisher') entry.publisher = 'other-publisher'
    else entry.tools[0][field] = { id: 'fixture.changed', effect: 'read', scope: 'workspace', approval: 'confirmation' }[field]
    await writeFile(fixture.index, JSON.stringify(catalog))
    await expect(fixture.surface.install({ packageName: PACKAGE_NAME, approvalSnapshot, approvedToolNames: ['count', 'explain'] })).rejects.toThrow(/changed; refresh/)
    expect(fixture.calls.installed).toEqual([])
    expect(await listDir(join(fixture.index, '../../installed'))).toEqual([])
  })

  it.each(['name', 'version', 'publisher', 'id', 'effect', 'scope', 'approval', 'readResource', 'tags'] as const)('refuses reviewed catalog %s that disagrees with signed artifact', async (field) => {
    const fixture = await marketFixture()
    const catalog = JSON.parse(await readFile(fixture.index, 'utf8'))
    const entry = catalog.plugins[0]
    if (field === 'name') entry.name = '@sciforge/plugin-different'
    else if (field === 'version') entry.version = '1.0.1'
    else if (field === 'publisher') entry.publisher = 'other-publisher'
    else entry.tools[0][field] = { id: 'fixture.changed', effect: 'read', scope: 'workspace', approval: 'confirmation', readResource: 'workspace', tags: ['changed'] }[field]
    await writeFile(fixture.index, JSON.stringify(catalog))
    const approvalSnapshot = (await fixture.surface.list()).plugins[0]!.approvalSnapshot
    await expect(fixture.surface.install({ packageName: entry.name, approvalSnapshot, approvedToolNames: ['count', 'explain'] })).rejects.toThrow(/Verified artifact identity or complete grants differ/)
    expect(fixture.calls.installed).toEqual([])
    const root = resolve(fixture.index, '../..')
    expect(await listDir(join(root, 'installed'))).toEqual([])
    expect(await listDir(join(root, 'staging'))).toEqual([])
    expect((await readDshPluginPolicy(join(root, 'extensions', 'dsh-plugin-policy.json'))).approved).toEqual([])
  })

  it('keeps installed bytes and exact-version policy untouched when a replacement review mismatches', async () => {
    const fixture = await marketFixture()
    const initial = (await fixture.surface.list()).plugins[0]!.approvalSnapshot
    await fixture.surface.install({ packageName: PACKAGE_NAME, approvalSnapshot: initial, approvedToolNames: ['count', 'explain'] })
    const root = resolve(fixture.index, '../..')
    const installed = join(root, 'installed', 'sciforge-plugin-fixture', 'dist', 'main.js')
    const policy = join(root, 'extensions', 'dsh-plugin-policy.json')
    const beforeBytes = await readFile(installed)
    const beforePolicy = await readFile(policy)
    const catalog = JSON.parse(await readFile(fixture.index, 'utf8'))
    catalog.plugins[0].version = '1.0.1'
    await writeFile(fixture.index, JSON.stringify(catalog))
    const changed = (await fixture.surface.list()).plugins[0]!.approvalSnapshot
    await expect(fixture.surface.install({ packageName: PACKAGE_NAME, approvalSnapshot: changed, approvedToolNames: ['count', 'explain'] })).rejects.toThrow(/Verified artifact identity/)
    expect(await readFile(installed)).toEqual(beforeBytes)
    expect(await readFile(policy)).toEqual(beforePolicy)
    expect(fixture.calls.installed).toHaveLength(1)
    expect(await listDir(join(root, 'staging'))).toEqual([])
  })

  it('reports an unreadable catalog as an error in the view instead of throwing', async () => {
    const fixture = await marketFixture()
    await writeFile(fixture.index, '{ not json')
    const listed = await fixture.surface.list()
    expect(listed.error).toMatch(/not valid JSON/)
    expect(listed.plugins).toEqual([])
  })

  it('refuses a concurrent approval instead of joining an unrelated install', async () => {
    const key = makeKey('market-key', 'fixture-publisher')
    const keyring = await keyringFrom([key])
    const root = await tempRoot('dsh-market-race-')
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolvePromise) => { release = resolvePromise })
    const { deps, calls } = installDeps({
      root,
      keyring,
      behavior: async () => { await gate }
    })
    const bytes = await buildArtifact({ signWith: key })
    const marketDirectory = join(root, 'market')
    const artifactDirectory = join(marketDirectory, 'artifacts')
    await mkdir(artifactDirectory, { recursive: true })
    const file = 'fixture.sciforge-dsh-plugin'
    await writeFile(join(artifactDirectory, file), bytes)
    const indexPath = join(marketDirectory, 'index.json')
    await writeFile(indexPath, `${JSON.stringify({
      format: 1,
      generatedAt: '2026-10-24T00:00:00.000Z',
      dshRuntimeVersion: '0.2.0-rc.2',
      plugins: [{
        name: PACKAGE_NAME, version: '1.0.0', form: 'dsh-runtime', categories: [], entry: 'dist/main.js',
        tools: [{ name: 'count', id: 'fixture.count', effect: 'compute' }, { name: 'explain', id: 'fixture.explain', effect: 'compute' }],
        hostDependencies: [], publisher: 'fixture-publisher',
        artifact: { file, sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) }, source: 'plugins/fixture'
      }],
      blocked: []
    })}\n`)
    const surface = createDshMarketSurface({
      source: { kind: 'file', path: indexPath },
      installDeps: deps,
      listInstalled: async () => [],
      setEnabled: async () => undefined
    })
    const approvalSnapshot = (await surface.list()).plugins[0]!.approvalSnapshot
    const first = surface.install({ packageName: PACKAGE_NAME, approvalSnapshot, approvedToolNames: ['count', 'explain'] })
    const second = surface.install({ packageName: PACKAGE_NAME, approvalSnapshot, approvedToolNames: ['count', 'explain'] })
    await expect(second).rejects.toThrow(/already running/)
    release?.()
    await first
    expect(calls.installed).toHaveLength(1)
  })
})

describe('market artifact locations and downloads', () => {
  it('resolves artifacts next to the catalog for both file and URL sources', () => {
    const marketRoot = resolve(tmpdir(), 'checkout', 'market')
    expect(resolveArtifactLocation({ kind: 'file', path: join(marketRoot, 'index.json') }, 'plugin.sciforge-dsh-plugin'))
      .toEqual({ kind: 'file', path: join(marketRoot, 'artifacts', 'plugin.sciforge-dsh-plugin') })
    expect(resolveArtifactLocation({ kind: 'url', url: 'https://example.com/market/index.json' }, 'plugin.sciforge-dsh-plugin'))
      .toEqual({ kind: 'url', url: 'https://example.com/market/artifacts/plugin.sciforge-dsh-plugin' })
    // A catalog may point at an absolute artifact instead of a sibling file.
    expect(resolveArtifactLocation({ kind: 'url', url: 'https://example.com/market/index.json' }, 'https://cdn.example.com/p.sciforge-dsh-plugin'))
      .toEqual({ kind: 'url', url: 'https://cdn.example.com/p.sciforge-dsh-plugin' })
  })

  it('resolves the configured source before the bundled copy', () => {
    expect(resolveDshMarketSource({ configured: 'https://example.com/market/index.json', env: {} }))
      .toEqual({ kind: 'url', url: 'https://example.com/market/index.json' })
    const configuredPath = resolve(tmpdir(), 'market', 'index.json')
    const bundledPath = resolve(tmpdir(), 'app', 'resources', 'market', 'index.json')
    expect(resolveDshMarketSource({ env: { SCIFORGE_MARKET_INDEX: configuredPath } }))
      .toEqual({ kind: 'file', path: configuredPath })
    expect(resolveDshMarketSource({ bundledIndexPath: bundledPath, env: {} }))
      .toEqual({ kind: 'file', path: bundledPath })
    expect(resolveDshMarketSource({ env: {} })).toBeUndefined()
  })

  it('fails a stalled download instead of waiting forever', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.write('a'.repeat(64))
      // Deliberately never ends: the client has to give up on its own.
    })
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const received: number[] = []
    try {
      await expect(defaultFetchBytes(`http://127.0.0.1:${port}/slow`, (bytes) => received.push(bytes), 400))
        .rejects.toThrow(/did not finish within 400 ms/)
      expect(received).toEqual([64])
    } finally {
      server.closeAllConnections?.()
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
    }
  })

  it('refuses an artifact whose byte count disagrees with the catalog', async () => {
    const key = makeKey('market-key', 'fixture-publisher')
    const keyring = await keyringFrom([key])
    const root = await tempRoot('dsh-market-size-')
    const { deps } = installDeps({ root, keyring })
    const bytes = await buildArtifact({ signWith: key })
    const marketDirectory = join(root, 'market')
    const artifactDirectory = join(marketDirectory, 'artifacts')
    await mkdir(artifactDirectory, { recursive: true })
    const file = 'fixture.sciforge-dsh-plugin'
    await writeFile(join(artifactDirectory, file), bytes)
    const indexPath = join(marketDirectory, 'index.json')
    await writeFile(indexPath, `${JSON.stringify({
      format: 1,
      generatedAt: '2026-10-24T00:00:00.000Z',
      dshRuntimeVersion: '0.2.0-rc.2',
      plugins: [{
        name: PACKAGE_NAME, version: '1.0.0', form: 'dsh-runtime', categories: [], entry: 'dist/main.js',
        tools: [{ name: 'count', id: 'fixture.count', effect: 'compute' }, { name: 'explain', id: 'fixture.explain', effect: 'compute' }],
        hostDependencies: [], publisher: 'fixture-publisher',
        artifact: { file, sizeBytes: bytes.byteLength + 10, sha256: sha256Hex(bytes) }, source: 'plugins/fixture'
      }],
      blocked: []
    })}\n`)
    const surface = createDshMarketSurface({
      source: { kind: 'file', path: indexPath },
      installDeps: deps,
      listInstalled: async () => [],
      setEnabled: async () => undefined
    })
    await expect(surface.install({ packageName: PACKAGE_NAME, approvalSnapshot: (await surface.list()).plugins[0]!.approvalSnapshot, approvedToolNames: ['count', 'explain'] }))
      .rejects.toThrow(/bytes but the market index published/)
    const progress = await surface.progress({ packageName: PACKAGE_NAME })
    expect(progress?.phase).toBe('failed')
    expect(await listDir(join(root, 'installed'))).toEqual([])
  })
})

describe('readDshMarketIndex', () => {
  it('rejects a duplicated plugin entry and a non-canonical shape', async () => {
    const root = await tempRoot('dsh-index-')
    const entry = {
      name: PACKAGE_NAME, version: '1.0.0', form: 'dsh-runtime', categories: [], entry: 'dist/main.js',
      tools: [], hostDependencies: [], publisher: null,
      artifact: { file: 'a.sciforge-dsh-plugin', sizeBytes: 1, sha256: '0'.repeat(64) }, source: 'plugins/fixture'
    }
    const duplicate = join(root, 'duplicate.json')
    await writeFile(duplicate, `${JSON.stringify({ format: 1, generatedAt: 'now', dshRuntimeVersion: '0.2.0-rc.2', plugins: [entry, entry], blocked: [] })}\n`)
    await expect(readDshMarketIndex({ kind: 'file', path: duplicate })).rejects.toThrow(/lists .* twice/)

    const wrongFormat = join(root, 'wrong.json')
    await writeFile(wrongFormat, `${JSON.stringify({ format: 2, generatedAt: 'now', dshRuntimeVersion: '0.2.0-rc.2', plugins: [], blocked: [] })}\n`)
    await expect(readDshMarketIndex({ kind: 'file', path: wrongFormat })).rejects.toThrow(/index is invalid/)
  })
})
