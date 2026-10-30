/**
 * Installer acceptance: the path from a built plugin to a real capability call.
 *
 *   build → pack (signed) → install through the installer → host discovers and
 *   activates it → the INSTALLED directory is loaded in a real plugin process and
 *   a capability is really invoked, producing a PNG → restart still loads it →
 *   disable → uninstall
 *
 * The render call reuses the plugin's own tested scenario (its `CONTROLLED_PLAN`
 * fixture) so the acceptance exercises the same input the plugin's own host-loading
 * test renders with. Nothing here is mocked: the plugin runs in a child process
 * and writes a real figure file.
 *
 * Usage:
 *   node --import tsx scripts/dsh-plugin-install-acceptance.mjs --key-dir <dir>
 *     [--plotting-python <interpreter with matplotlib>]
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const { ensureMarketWorkDir } = await import('./market-work-dir.mjs')
const HOST_API_VERSION = '1.0.0'
const DSH_RUNTIME_VERSION = '0.2.0-rc.2'
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
  const plottingPython = argument('plotting-python', process.env.SCIFORGE_ACCEPTANCE_PLOTTING_PYTHON)

  const { packDshPlugin, generatePublisherKeypair } = await import(
    pathToFileURL(resolve('scripts/dsh-plugin-package.mjs')).href
  )
  const { readDshPluginArtifact } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-artifact.ts')).href
  )
  const { loadDshPublisherKeyring } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-signature.ts')).href
  )
  const { emptyDshPluginPolicy, policyContracts, readDshPluginPolicy } = await import(
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
  const { ProcessExtensionHost } = await import(
    pathToFileURL(resolve('packages/plugin-sdk/src/process-extension-host.js')).href
  )
  const { HOST_BUSINESS_INVOKE_TIMEOUT_MS } = await import(
    pathToFileURL(resolve('src/main/extensions/invocation-budgets.ts')).href
  )
  const { CONTROLLED_PLAN } = await import(
    pathToFileURL(resolve(`${PILOT.directory}/tests/scenario.ts`)).href
  )

  // 1. Build the pilot plugin with the repository's own build script.
  await execFileAsync('npm', ['run', 'build'], { cwd: resolve(PILOT.directory), maxBuffer: 32 * 1024 * 1024 })
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
  const grants = Object.fromEntries(Object.entries(artifact.manifest.tools).map(([name, grant]) => [name, { id: grant.id, effect: grant.effect }]))

  // 3. Install through the installer into a throwaway profile.
  const root = await mkdtemp(join(tmpdir(), 'sciforge-install-acceptance-'))
  const userData = join(root, 'profile')
  const installedRoot = join(userData, 'extensions', 'plugin-packages')
  const stagingRoot = join(userData, 'extensions', 'staging')
  const policyPath = join(userData, 'extensions', 'dsh-plugin-policy.json')
  const workspaceRoot = join(root, 'workspace')
  await mkdir(installedRoot, { recursive: true })
  await mkdir(workspaceRoot, { recursive: true })

  const publisherKeyring = await loadDshPublisherKeyring(resolve(keyringPath))
  const createService = async () => new DevelopmentExternalPluginService({
    root: installedRoot,
    userDataPath: userData,
    hostApiVersion: HOST_API_VERSION,
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    adapterContracts: policyContracts(await readDshPluginPolicy(policyPath)),
    allowedPermissionIds: new Set(),
    // The host vendors the native addon and approves the renderer interpreter;
    // the plugin child process inherits neither on its own.
    pluginRuntimeDeps: {
      packages: ['@napi-rs/canvas'],
      baseUrl: pathToFileURL(join(process.cwd(), 'package.json')).href
    },
    ...(plottingPython ? { pluginRuntimeEnv: { SCIFORGE_PYTHON: plottingPython } } : {})
  })
  let service = await createService()
  await service.initialize()
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
      installFromDirectory: (directory, contract) => holder.current.installFromDirectory(directory, contract),
      uninstall: (packageName) => holder.current.uninstall(packageName),
      refreshDiscoveredPlugins: () => holder.current.refreshDiscoveredPlugins()
    }
  }, {
    artifactPath: packed.artifact,
    expectedSha256: packed.sha256,
    approvedToolNames,
    source: 'installer-acceptance'
  }, emptyDshPluginPolicy())
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

  // 6. Real execution: load the INSTALLED directory in a real plugin process and
  //    invoke a capability that produces an actual figure file.
  const authorized = []
  const host = new ProcessExtensionHost({
    invokeTimeoutMs: HOST_BUSINESS_INVOKE_TIMEOUT_MS,
    resolveDshToolGrants: () => grants,
    resolveDshConfig: () => ({}),
    pluginRuntimeDeps: {
      packages: ['@napi-rs/canvas'],
      baseUrl: pathToFileURL(join(process.cwd(), 'package.json')).href
    },
    ...(plottingPython ? { pluginRuntimeEnv: { SCIFORGE_PYTHON: plottingPython } } : {}),
    authorizeDshTool: (request) => authorized.push(request.capabilityId)
  })
  const invocation = Object.freeze({
    caller: {},
    ordinarySession: Object.freeze({ runtimeId: 'acceptance-runtime', threadId: 'thread-1', sessionId: 'session-1' }),
    context: {}
  })
  // The plugin's status capability asks the host for a child-local ordinary Agent
// resolver; this is the same minimal resolver shape the plugin's own host-loading
// test provides. Without it the host refuses the call instead of inventing one.
  const resolverPath = join(root, 'agent-resolver.mjs')
  await writeFile(resolverPath, `import { createScope } from '@deepseek-ai/dsh-scope'
export function resolveAgent({ identity, rootContext }) {
  const agent = { id: identity.sessionId, session: { id: identity.sessionId } }
  const scope = createScope(rootContext, agent)
  agent.ctx = scope.ctx
  return { agent, dispose: scope.dispose }
}
`)

  try {
    const snapshot = await host.replace({
      pluginId: 'scientific-plotting',
      packageName: PILOT.packageName,
      version: installed.version,
      entryPath: join(installed.installedDirectory, artifact.manifest.entry),
      dshAgentResolver: { path: resolverPath }
    })
    const runtime = host.runtime(PILOT.packageName)
    assert(runtime, 'the installed plugin produced no runtime')
    const invoke = async (id, input) => (await runtime.invoke(id, input, undefined, undefined, undefined, invocation)).output

    const status = await invoke('scientific-plotting.status', {})
    assert(status.ok === true, `status returned ${JSON.stringify(status).slice(0, 200)}`)
    assert(status.serverName === 'scientific_plotting', `unexpected server name ${String(status.serverName)}`)

    const rendered = await invoke('scientific-plotting.render', {
      operationId: 'install-acceptance-render-1',
      visualPlan: CONTROLLED_PLAN,
      data: { series: [{ name: 'S1', x: [1, 2, 3], y: [2, 4, 9] }] },
      template: 'scatter',
      workspaceRoot
    })
    assert(rendered.ok === true, `render failed: ${JSON.stringify(rendered).slice(0, 300)}`)
    assert(rendered.status === 'rendered', `render status ${String(rendered.status)}`)

    const figuresDir = join(workspaceRoot, '.sciforge', 'figures')
    const figures = await readdir(figuresDir, { withFileTypes: true })
    const png = figures.filter((entry) => entry.isDirectory())
    let pngPath
    for (const directory of png) {
      const nested = await readdir(join(figuresDir, directory.name, 'versions'), { withFileTypes: true }).catch(() => [])
      for (const version of nested) {
        const files = await readdir(join(figuresDir, directory.name, 'versions', version.name)).catch(() => [])
        const found = files.find((file) => file.endsWith('.png'))
        if (found) pngPath = join(figuresDir, directory.name, 'versions', version.name, found)
      }
    }
    if (!pngPath) {
      const files = await readdir(figuresDir, { recursive: true }).catch(() => [])
      pngPath = files.map((file) => join(figuresDir, String(file))).find((file) => file.endsWith('.png'))
    }
    assert(pngPath, `no PNG was produced under ${figuresDir}`)
    const pngStat = await stat(pngPath)
    assert(pngStat.size > 0, 'the produced PNG is empty')
    step('real invocation produces an artifact', {
      capabilityIds: [...snapshot.capabilityIds].sort(),
      serverName: status.serverName,
      renderStatus: rendered.status,
      pngFile: pngPath.replace(`${root}/`, ''),
      pngBytes: pngStat.size,
      authorizedTools: authorized,
      warnings: rendered.warnings ?? []
    })
  } finally {
    await host.disposeAll().catch(() => undefined)
  }

  // 7. Restart: a fresh service over the same profile still loads it.
  await holder.current.dispose().catch(() => undefined)
  service = await createService()
  holder.current = service
  await service.initialize()
  const afterRestart = (await service.list()).find((entry) => entry.packageName === PILOT.packageName)
  assert(afterRestart?.enabled === true, 'the plugin did not survive a restart')
  step('survives restart', { enabled: afterRestart.enabled, version: afterRestart.version })

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
      installFromDirectory: (directory, contract) => holder.current.installFromDirectory(directory, contract),
      uninstall: (packageName) => holder.current.uninstall(packageName),
      refreshDiscoveredPlugins: () => holder.current.refreshDiscoveredPlugins()
    }
  }, PILOT.packageName, await readDshPluginPolicy(policyPath))
  const gone = (await holder.current.list()).find((entry) => entry.packageName === PILOT.packageName)
  assert(!gone, 'the plugin is still listed after uninstall')
  step('uninstall', { remaining: (await holder.current.list()).length })

  await holder.current.dispose().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ ok: true, steps }, null, 2)}\n`)
  process.exit(0)
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, steps }, null, 2)}\n`)
  process.exit(1)
})