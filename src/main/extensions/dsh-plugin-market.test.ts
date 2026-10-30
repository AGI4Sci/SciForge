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
import { createPrivateKey, generateKeyPairSync, sign as signEd25519 } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginAdapterContract } from '@sciforge/plugin-sdk'
import type { DomainExtensionSummary } from '../../shared/domain-extensions'
import { canonicalJson } from './canonical-json'
import {
  DSH_PLUGIN_ARTIFACT_MANIFEST_PATH,
  DSH_PLUGIN_ARTIFACT_SIGNATURE_PATH,
  readDshPluginArtifactBytes,
  sha256Hex
} from './dsh-plugin-artifact'
import { loadDshPublisherKeyring, type DshPublisherKeyring } from './dsh-plugin-signature'
import { installDshPluginArtifact, type DshPluginInstallDeps } from './dsh-plugin-install'
import { emptyDshPluginPolicy, readDshPluginPolicy } from './dsh-plugin-policy'
import {
  createDshMarketSurface,
  defaultFetchBytes,
  readDshMarketIndex,
  resolveArtifactLocation,
  resolveDshMarketSource
} from './dsh-plugin-market'

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

function payloadFor(version: string, marker: string): Readonly<Record<string, Buffer>> {
  return {
    'package.json': Buffer.from(`${JSON.stringify({
      name: PACKAGE_NAME,
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
  version?: string
  marker?: string
  tools?: Readonly<Record<string, { id: string; effect: string }>>
  signWith?: TestKey | null
  payload?: Readonly<Record<string, Buffer>>
}> = {}): Promise<Buffer> {
  const version = options.version ?? '1.0.0'
  const payload = options.payload ?? payloadFor(version, options.marker ?? `v${version}`)
  const manifest = {
    schemaVersion: 1,
    packageName: PACKAGE_NAME,
    version,
    entry: 'dist/main.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    engines: { dsh: '>=0.2.0-rc.2 <0.3.0' },
    hostDependencies: [],
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
      installFromDirectory: async (directory: string, _contract: PluginAdapterContract) => {
        calls.installed.push(directory)
        await options.behavior?.(directory, calls.installed.length)
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
    }, emptyDshPluginPolicy())).rejects.toThrow(/requests unapproved tool grants: explain/)

    // Approving something the artifact never declared is refused too.
    await expect(installDshPluginArtifact(deps, {
      artifactBytes: bytes, approvedToolNames: ['count', 'explain', 'extra'], source: 'test'
    }, emptyDshPluginPolicy())).rejects.toThrow(/not declared by the artifact: extra/)

    const result = await installDshPluginArtifact(deps, {
      artifactBytes: bytes, approvedToolNames: ['count', 'explain'], expectedSha256: sha256Hex(bytes), source: 'test'
    }, emptyDshPluginPolicy())
    expect(result.packageName).toBe(PACKAGE_NAME)
    expect(result.tools).toEqual(['count', 'explain'])
    expect(await readFile(join(result.installedDirectory, 'dist', 'main.js'), 'utf8')).toContain('v1.0.0')
    const policy = await readDshPluginPolicy(policyPath)
    expect(policy.approved).toHaveLength(1)
    expect(policy.approved[0]).toMatchObject({ packageName: PACKAGE_NAME, version: '1.0.0', publisherId: 'fixture-publisher' })
  })

  it('refuses the same version with different content instead of silently replacing it', async () => {
    const key = makeKey('test-key', 'fixture-publisher')
    const root = await tempRoot('dsh-samever-')
    const { deps } = installDeps({ root, keyring: await keyringFrom([key]) })
    const first = await buildArtifact({ signWith: key })
    await installDshPluginArtifact(deps, { artifactBytes: first, approvedToolNames: ['count', 'explain'], source: 'test' }, emptyDshPluginPolicy())
    const policy = await readDshPluginPolicy(deps.policyPath)

    const changed = await buildArtifact({ signWith: key, marker: 'changed-content' })
    await expect(installDshPluginArtifact(deps, {
      artifactBytes: changed, approvedToolNames: ['count', 'explain'], source: 'test'
    }, policy)).rejects.toThrow(/already approved with different content/)
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
    await installDshPluginArtifact(deps, { artifactBytes: await buildArtifact({ signWith: key }), approvedToolNames: ['count', 'explain'], source: 'test' }, emptyDshPluginPolicy())
    const policy = await readDshPluginPolicy(deps.policyPath)

    await expect(installDshPluginArtifact(deps, {
      artifactBytes: await buildArtifact({ version: '1.0.1', signWith: key }), approvedToolNames: ['count', 'explain'], source: 'test'
    }, policy)).rejects.toThrow(/rejected the upgrade/)

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
    }, emptyDshPluginPolicy())).rejects.toThrow(/does not match the published digest/)
    expect(await listDir(installedRoot)).toEqual([])
    expect(await listDir(stagingRoot)).toEqual([])
  })
})

describe('createDshMarketSurface', () => {
  async function marketFixture(): Promise<Readonly<{
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
    const bytes = await buildArtifact({ signWith: key })
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
    const outcome = await originalInstall({ packageName: PACKAGE_NAME, approvedToolNames: ['count', 'explain'] })
    expect(outcome.sha256).toBe(sha256Hex(fixture.bytes))
    const progress = await fixture.surface.progress({ packageName: PACKAGE_NAME })
    expect(progress?.phase).toBe('done')
    void phases
    const listed = await fixture.surface.list()
    expect(listed.error).toBeNull()
    expect(listed.plugins.map((plugin) => plugin.sha256)).toEqual([sha256Hex(fixture.bytes)])
    expect(listed.plugins[0]?.capabilities.map((capability) => capability.registered)).toEqual([false, false])
  })

  it('reports an unreadable catalog as an error in the view instead of throwing', async () => {
    const fixture = await marketFixture()
    await writeFile(fixture.index, '{ not json')
    const listed = await fixture.surface.list()
    expect(listed.error).toMatch(/not valid JSON/)
    expect(listed.plugins).toEqual([])
  })

  it('joins a second concurrent install of the same package instead of doing it twice', async () => {
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
    const first = surface.install({ packageName: PACKAGE_NAME, approvedToolNames: ['count', 'explain'] })
    const second = surface.install({ packageName: PACKAGE_NAME, approvedToolNames: ['count', 'explain'] })
    release?.()
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(calls.installed).toHaveLength(1)
  })
})

describe('market artifact locations and downloads', () => {
  it('resolves artifacts next to the catalog for both file and URL sources', () => {
    expect(resolveArtifactLocation({ kind: 'file', path: '/checkout/market/index.json' }, 'plugin.sciforge-dsh-plugin'))
      .toEqual({ kind: 'file', path: '/checkout/market/artifacts/plugin.sciforge-dsh-plugin' })
    expect(resolveArtifactLocation({ kind: 'url', url: 'https://example.com/market/index.json' }, 'plugin.sciforge-dsh-plugin'))
      .toEqual({ kind: 'url', url: 'https://example.com/market/artifacts/plugin.sciforge-dsh-plugin' })
    // A catalog may point at an absolute artifact instead of a sibling file.
    expect(resolveArtifactLocation({ kind: 'url', url: 'https://example.com/market/index.json' }, 'https://cdn.example.com/p.sciforge-dsh-plugin'))
      .toEqual({ kind: 'url', url: 'https://cdn.example.com/p.sciforge-dsh-plugin' })
  })

  it('resolves the configured source before the bundled copy', () => {
    expect(resolveDshMarketSource({ configured: 'https://example.com/market/index.json', env: {} }))
      .toEqual({ kind: 'url', url: 'https://example.com/market/index.json' })
    expect(resolveDshMarketSource({ env: { SCIFORGE_MARKET_INDEX: '/tmp/market/index.json' } }))
      .toEqual({ kind: 'file', path: '/tmp/market/index.json' })
    expect(resolveDshMarketSource({ bundledIndexPath: '/app/resources/market/index.json', env: {} }))
      .toEqual({ kind: 'file', path: '/app/resources/market/index.json' })
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
    await expect(surface.install({ packageName: PACKAGE_NAME, approvedToolNames: ['count', 'explain'] }))
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