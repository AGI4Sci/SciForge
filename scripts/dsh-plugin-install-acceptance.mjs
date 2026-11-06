/**
 * Installer acceptance: the path from a built plugin to a real capability call.
 *
 *   build → pack (signed) → install through the installer → host discovers and
 *   activates it → the INSTALLED directory is loaded in a real plugin process and
 *   an operation imports and reads a real PNG → restart still loads it →
 *   disable → uninstall
 *
 * This is installer/process evidence using an explicit synthetic Host session,
 * not real Agent/runtime or Python execution acceptance. Calls use the production
 * capability broker and nativeExecution provider; no private worker bypass runs.
 *
 * Usage:
 *   node --import tsx scripts/dsh-plugin-install-acceptance.mjs --key-dir <dir>
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { domainPackageNpmInvocation } from './domain-packages.mjs'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const { ensureMarketWorkDir } = await import('./market-work-dir.mjs')
const HOST_API_VERSION = '1.0.0'
const DSH_RUNTIME_VERSION = JSON.parse(await readFile(new URL('../node_modules/@deepseek-ai/dsh-tools/package.json', import.meta.url), 'utf8')).version
const HOST_PROVIDED = new Set(['@deepseek-ai/dsh-tools', '@napi-rs/canvas'])
const PILOT = { directory: 'plugins/scientific-plotting', packageName: '@sciforge/plugin-scientific-plotting' }
const steps = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function step(name, detail) {
  steps.push({ step: name, ok: true, detail })
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

async function main() {
  const keyDir = argument('key-dir', process.env.SCIFORGE_TEST_KEY_DIR)
  if (!keyDir) throw new Error('--key-dir is required: signing uses a repository-external test key.')

  const { packDshPlugin, generatePublisherKeypair } = await import(
    pathToFileURL(resolve('scripts/dsh-plugin-package.mjs')).href
  )
  const { readDshPluginArtifact } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-artifact.ts')).href
  )
  const { loadDshPublisherKeyring } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-signature.ts')).href
  )
  const { policyContracts, readDshPluginPolicy } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-policy.ts')).href
  )
  const {
    installDshPluginArtifact,
    uninstallDshPlugin,
    installedPluginPathFor
  } = await import(pathToFileURL(resolve('src/main/extensions/dsh-plugin-install.ts')).href)
  const { DevelopmentExternalPluginService } = await import(
    pathToFileURL(resolve('src/main/extensions/development-external-plugins.ts')).href
  )
  const { CapabilityRegistry } = await import(pathToFileURL(resolve('src/main/capabilities/registry.ts')).href)
  const { CapabilityBroker } = await import(pathToFileURL(resolve('src/main/capabilities/broker.ts')).href)
  const { createNativeExecutionHostService } = await import(pathToFileURL(resolve('src/main/extensions/native-execution-host-service.ts')).href)
  const { ensureDshAgentResolverModule } = await import(pathToFileURL(resolve('src/main/extensions/dsh-agent-resolver.ts')).href)

  // 1. Build the pilot plugin with the repository's own build script.
  const npm = domainPackageNpmInvocation({ npmExecPath: process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') })
  await execFileAsync(npm.command, [...npm.leadingArguments, 'run', 'build'], { cwd: resolve(PILOT.directory), maxBuffer: 32 * 1024 * 1024 })
  step('build pilot plugin', { plugin: PILOT.directory })

  // 2. Pack it signed with the repository-external test key.
  const keys = resolve(keyDir)
  await mkdir(keys, { recursive: true })
  const keyId = 'market-publisher-key'
  const publisherId = 'sciforge-market'
  const privateKeyPath = join(keys, `${keyId}.private.pem`)
  const keyringPath = join(keys, 'dsh-publisher-keys.json')
  try {
    await readFile(privateKeyPath)
  } catch {
    await generatePublisherKeypair({ outDir: keys, keyId, publisherId })
  }
  const packed = await packDshPlugin({
    source: PILOT.directory,
    outDir: resolve(await ensureMarketWorkDir(), 'artifacts'),
    signingKeyPath: privateKeyPath,
    keyId,
    publisherId
  })
  step('pack signed artifact', { artifact: packed.artifact, sizeBytes: packed.sizeBytes, sha256: packed.sha256, signature: packed.signature })

  const artifact = await readDshPluginArtifact(packed.artifact)
  const approvedToolNames = Object.keys(artifact.manifest.tools).sort()
  // 3. Install through the installer into a throwaway profile.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sciforge-install-acceptance-')))
  const userData = join(root, 'profile')
  const installedRoot = join(userData, 'extensions', 'plugin-packages')
  const stagingRoot = join(userData, 'extensions', 'staging')
  const policyPath = join(userData, 'extensions', 'dsh-plugin-policy.json')
  const workspaceRoot = join(root, 'workspace')
  await mkdir(installedRoot, { recursive: true })
  await mkdir(workspaceRoot, { recursive: true })

  const publisherKeyring = await loadDshPublisherKeyring(resolve(keyringPath))
  const caller = Object.freeze({ audience: 'agent', callerId: 'installer-acceptance', workspaceId: workspaceRoot, approvals: [] })
  const session = Object.freeze({ runtimeId: 'installer-acceptance-fixture', threadId: 'thread-1' })
  const registry = new CapabilityRegistry()
  const broker = new CapabilityBroker(registry)
  const dshAgentResolver = await ensureDshAgentResolverModule(userData)
  const authorized = []
  const nativeExecution = createNativeExecutionHostService({
    resolveContext: request => {
      const authority = request.owner.authority
      assert(authority?.caller?.workspaceId === workspaceRoot, 'native context must retain the caller workspace')
      assert(authority?.ordinarySession?.runtimeId === session.runtimeId, 'native context must retain the synthetic session')
      authorized.push(authority.capabilityId)
      return { workspaceRoot, policy: { mode: 'workspace-write', workspaceRoot } }
    },
    requestApproval: () => 'unavailable'
  })
  const createService = async () => {
    const contracts = policyContracts(await readDshPluginPolicy(policyPath))
    // The installer admits this exact signed artifact before activation. Its new
    // policy is persisted during install, after the service's initial map loads.
    const approvedNative = (name, version) => name === artifact.manifest.packageName
      && version === artifact.manifest.version && artifact.manifest.hostServices?.includes('nativeExecution') === true
    const service = new DevelopmentExternalPluginService({
      root: installedRoot, userDataPath: userData, hostApiVersion: HOST_API_VERSION,
      dshRuntimeVersion: DSH_RUNTIME_VERSION, adapterContracts: contracts,
      allowedPermissionIds: new Set(), dshAgentResolver,
      authorizeWorkspace: request => request.workspaceId === workspaceRoot,
      hostServiceIds: ['nativeExecution'],
      resolveHostServiceProviders: (name, version) => approvedNative(name, version) ? { nativeExecution } : undefined,
      resolveHostServiceClients: (name, version) => approvedNative(name, version) ? [{
        serviceId: 'nativeExecution', provides: ['workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess', 'approval', 'commands'],
        modulePath: resolve('packages/plugin-sdk/src/native-execution-client.mjs'), exportName: 'createNativeExecutionClients', config: {}
      }] : [],
      pluginRuntimeDeps: { packages: ['@napi-rs/canvas'], baseUrl: pathToFileURL(resolve('package.json')).href }
    })
    await service.initialize()
    await service.attachCapabilityRegistry(registry)
    return service
  }
  let service = await createService()
  const holder = { current: service }

  const installed = await installDshPluginArtifact({
    installedRoot,
    stagingRoot,
    policyPath,
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    hostApiRange: '^1.0.0',
    hostProvidedDependencies: HOST_PROVIDED,
    publisherKeyring,
    service: {
      installFromDirectory: (directory, contract, restoreInstallation) => holder.current.installFromDirectory(directory, contract, restoreInstallation),
      uninstall: (packageName) => holder.current.uninstall(packageName),
      refreshDiscoveredPlugins: () => holder.current.refreshDiscoveredPlugins()
    }
  }, {
    artifactPath: packed.artifact,
    expectedSha256: packed.sha256,
    approvedToolNames,
    // Explicit engineering review, not a human market approval.
    expectedApproval: { packageName: artifact.manifest.packageName, version: artifact.manifest.version,
      sha256: packed.sha256, publisher: publisherId, entry: artifact.manifest.entry,
      tools: Object.entries(artifact.manifest.tools).map(([name, grant]) => ({ name, ...grant })),
      ports: artifact.manifest.ports ?? [], hostDependencies: artifact.manifest.hostDependencies },
    approvedPorts: artifact.manifest.ports ?? [],
    source: 'installer-acceptance'
  })
  step('install artifact', { packageName: installed.packageName, version: installed.version, directory: installed.installedDirectory, tools: installed.tools })

  // 4. The host discovered and activated it.
  const listed = (await holder.current.list()).find((entry) => entry.packageName === PILOT.packageName)
  assert(listed?.enabled === true, 'the installer left the plugin disabled')
  step('host discovers + activates', { packageName: listed.packageName, enabled: listed.enabled })

  // 5. The approval is recorded, bound to the trusted publisher.
  const policy = await readDshPluginPolicy(policyPath)
  const approval = policy.approved.find((entry) => entry.packageName === PILOT.packageName)
  assert(approval, 'no approval was recorded')
  assert(approval.publisherId === publisherId, `approval recorded publisher ${String(approval.publisherId)}`)
  assert(Object.keys(approval.tools ?? {}).length === approvedToolNames.length, 'the approval does not cover every declared tool')
  step('host policy recorded', { publisherId: approval.publisherId, tools: Object.keys(approval.tools ?? {}) })

  // 6. Invoke the installed process through the same broker lane as ordinary sessions.
  // The fixture scope is explicitly synthetic; this is not live Agent evidence.
  const operationId = 'scientific-figures.operation'
  assert(artifact.manifest.tools.scientific_figures?.id === operationId, 'pilot must expose the canonical operation')
  let invocationSequence = 0
  const invoke = async (action, input, extra = {}) => (await broker.invokeOrdinarySession(caller, {
    actionId: operationId, invocationId: `install-${action}-${++invocationSequence}`, input: { action, input, ...extra }
  }, session)).output
  const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=', 'base64')
  await writeFile(join(workspaceRoot, 'original.png'), original)
  const input = { documentId: 'installer-acceptance', operationId: 'import-1', expectedDocumentRevision: 0, path: 'original.png' }
  const forgedWorkspace = join(root, 'forged-workspace')
  let rejectedForeignRoot = false
  const authorizedBeforeForgery = authorized.length
  try { await invoke('importOriginal', input, { workspaceRoot: forgedWorkspace }) }
  catch { rejectedForeignRoot = true }
  assert(rejectedForeignRoot, 'an explicit foreign workspaceRoot must be rejected before dispatch')
  assert(authorized.length === authorizedBeforeForgery, 'foreign workspace reached native execution')
  assert(await stat(forgedWorkspace).then(() => false, () => true), 'foreign workspace must remain absent')
  step('foreign workspace rejected', { rejected: true })
  const imported = await invoke('importOriginal', input)
  const document = await invoke('read', { documentId: input.documentId })
  assert(document.documentId === input.documentId && document.documentRevision === 1, 'canonical figure document was not persisted')
  assert(document.currentRevisionId === imported.currentRevisionId, 'read must return the imported current revision')
  const image = await invoke('image', { documentId: document.documentId, revisionId: document.currentRevisionId })
  assert(image.width === 1 && image.height === 1 && image.src.startsWith('data:image/png;base64,'), 'installed process did not read the persisted PNG')
  assert((await readFile(join(workspaceRoot, 'original.png'))).equals(original), 'immutable original changed')
  step('real installed operation persists and reads an artifact', {
    capabilityIds: [operationId], documentId: document.documentId, documentRevision: document.documentRevision,
    pngBytes: original.length, authorizedHostOperations: authorized.length,
    evidenceScope: 'installer-process-with-synthetic-session', realAgentAcceptance: false
  })

  // 7. Restart: a fresh service over the same profile still loads it.
  await holder.current.dispose().catch(() => undefined)
  service = await createService()
  holder.current = service
  const afterRestart = (await service.list()).find((entry) => entry.packageName === PILOT.packageName)
  assert(afterRestart?.enabled === true, 'the plugin did not survive a restart')
  const restored = await invoke('read', { documentId: input.documentId })
  assert(restored.currentRevisionId === document.currentRevisionId, 'restart changed the persisted figure')
  step('survives restart', { enabled: afterRestart.enabled, version: afterRestart.version, documentId: restored.documentId })

  // 8. Disable.
  await holder.current.setEnabled(PILOT.packageName, false)
  const disabled = (await holder.current.list()).find((entry) => entry.packageName === PILOT.packageName)
  assert(disabled && disabled.enabled === false, 'disable did not take effect')
  step('disable', { enabled: disabled.enabled })

  // 9. Uninstall removes the directory, the approval and the listing.
  await uninstallDshPlugin({
    installedRoot,
    stagingRoot,
    policyPath,
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    hostApiRange: '^1.0.0',
    hostProvidedDependencies: HOST_PROVIDED,
    publisherKeyring,
    service: {
      installFromDirectory: (directory, contract, restoreInstallation) => holder.current.installFromDirectory(directory, contract, restoreInstallation),
      uninstall: (packageName) => holder.current.uninstall(packageName),
      refreshDiscoveredPlugins: () => holder.current.refreshDiscoveredPlugins()
    }
  }, PILOT.packageName)
  const gone = (await holder.current.list()).find((entry) => entry.packageName === PILOT.packageName)
  assert(!gone, 'the plugin is still listed after uninstall')
  step('uninstall', { remaining: (await holder.current.list()).length })

  await holder.current.dispose().catch(() => undefined)
  step('isolated evidence retained', { root })
  process.stdout.write(`${JSON.stringify({ ok: true, steps }, null, 2)}\n`)
  process.exit(0)
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, steps }, null, 2)}\n`)
  process.exit(1)
})