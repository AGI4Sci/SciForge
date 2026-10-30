/**
 * Generic plugin acceptance for a newly written plugin.
 *
 *   build → pack (signed) → install → host discovers and activates it →
 *   real capability calls with several inputs in a real plugin process →
 *   an invalid input must be refused *by the plugin* → a full restart must still
 *   be able to call it → the Host registry must expose it while enabled and stop
 *   exposing it while disabled → uninstall leaves nothing behind → after another
 *   restart nothing is loaded.
 *
 * The same script runs for any plugin: nothing here knows about a specific
 * plugin's business logic, only about the plugin root, its capability id and the
 * inputs to send.
 *
 * Usage:
 *   node --import tsx scripts/dsh-plugin-verify.mjs \
 *     --plugin tests/fixtures/dsh-plugins/text-stats \
 *     --key-dir <repo-external test keys> \
 *     --call text-stats.count --args '{"text":"hello world"}' --args '{"text":"你好"}' \
 *     --invalid-args '{}' [--expect-invalid-code invalid_request]
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const { ensureMarketWorkDir } = await import('./market-work-dir.mjs')
const HOST_API_VERSION = '1.0.0'
const DSH_RUNTIME_VERSION = '0.2.0-rc.2'
const HOST_PROVIDED = new Set(['@deepseek-ai/dsh-tools', '@napi-rs/canvas'])
const steps = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * 有界等待：宿主的注册表是随 capabilities 消息异步填充的，断言不能抢在消息到达前跑。
 * 只在超时后失败（保持"必须真的暴露"的强度），等待窗口 5 秒。
 */
async function waitFor(assertion, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await assertion()) return
    if (Date.now() > deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function step(name, detail) {
  steps.push({ step: name, ok: true, detail })
}

function flag(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

function flagAll(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1] !== undefined) values.push(process.argv[index + 1])
  }
  return values
}

async function main() {
  const pluginDirectory = flag('plugin')
  const keyDir = flag('key-dir') ?? process.env.SCIFORGE_TEST_KEY_DIR
  const capabilityId = flag('call')
  const inputs = flagAll('args').map((value) => JSON.parse(value))
  const invalidInput = flag('invalid-args') === undefined ? undefined : JSON.parse(flag('invalid-args'))
  if (!pluginDirectory) throw new Error('--plugin is required.')
  if (!keyDir) throw new Error('--key-dir is required: signing uses a repository-external test key.')
  if (!capabilityId) throw new Error('--call is required.')
  if (inputs.length < 2) throw new Error('Provide at least two --args inputs to prove the output follows the input.')

  const { packDshPlugin, generatePublisherKeypair } = await import(
    pathToFileURL(resolve('scripts/dsh-plugin-package.mjs')).href
  )
  const { readDshPluginArtifact } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-artifact.ts')).href
  )
  const { verifyDshPluginSignature, loadDshPublisherKeyring } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-signature.ts')).href
  )
  const { emptyDshPluginPolicy, policyContracts, readDshPluginPolicy } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-policy.ts')).href
  )
  const {
    installDshPluginArtifact,
    uninstallDshPlugin
  } = await import(pathToFileURL(resolve('src/main/extensions/dsh-plugin-install.ts')).href)
  const { DevelopmentExternalPluginService } = await import(
    pathToFileURL(resolve('src/main/extensions/development-external-plugins.ts')).href
  )
  const { CapabilityRegistry } = await import(
    pathToFileURL(resolve('src/main/capabilities/registry.ts')).href
  )
  const { ProcessExtensionHost } = await import(
    pathToFileURL(resolve('packages/plugin-sdk/src/process-extension-host.js')).href
  )
  const { HOST_BUSINESS_INVOKE_TIMEOUT_MS } = await import(
    pathToFileURL(resolve('src/main/extensions/invocation-budgets.ts')).href
  )
  // The same resolver module the app writes into its profile: a tool invocation
  // is refused outright when the host has not provided one.
  const { ensureDshAgentResolverModule } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-agent-resolver.ts')).href
  )

  // 1. Build with the plugin's own build script.
  await rm(resolve(pluginDirectory, 'dist'), { recursive: true, force: true })
  await execFileAsync('npm', ['run', 'build'], { cwd: resolve(pluginDirectory), maxBuffer: 32 * 1024 * 1024 })
  const packageJson = JSON.parse(await readFile(join(resolve(pluginDirectory), 'package.json'), 'utf8'))
  step('build plugin', { plugin: pluginDirectory, packageName: packageJson.name, version: packageJson.version })

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
    source: pluginDirectory,
    outDir: resolve(await ensureMarketWorkDir(), 'artifacts'),
    signingKeyPath: privateKeyPath,
    keyId,
    publisherId
  })
  const artifact = await readDshPluginArtifact(packed.artifact)
  const approvedToolNames = Object.keys(artifact.manifest.tools).sort()
  assert(approvedToolNames.length > 0, 'the artifact declares no tools')
  const publisherKeyring = await loadDshPublisherKeyring(keyringPath)
  const trust = verifyDshPluginSignature({
    manifestBytes: artifact.manifestBytes,
    signatureBytes: artifact.signatureBytes,
    keyring: publisherKeyring
  })
  step('pack + verify signature', {
    artifact: packed.artifact.split('/').pop(),
    sizeBytes: packed.sizeBytes,
    sha256: packed.sha256,
    publisherId: trust.publisherId,
    tools: approvedToolNames,
    entry: artifact.manifest.entry
  })

  // 3. Install into a throwaway profile through the real installer.
  const root = await mkdtemp(join(tmpdir(), 'sciforge-plugin-verify-'))
  const userData = join(root, 'profile')
  const installedRoot = join(userData, 'extensions', 'plugin-packages')
  const policyPath = join(userData, 'extensions', 'dsh-plugin-policy.json')
  await mkdir(installedRoot, { recursive: true })

  const registry = new CapabilityRegistry()
  const createService = async () => {
    const service = new DevelopmentExternalPluginService({
      root: installedRoot,
      userDataPath: userData,
      hostApiVersion: HOST_API_VERSION,
      dshRuntimeVersion: DSH_RUNTIME_VERSION,
      adapterContracts: policyContracts(await readDshPluginPolicy(policyPath)),
      allowedPermissionIds: new Set(),
      // 宿主代解析的原生依赖：按"本构建能提供什么"给解析根（根 node_modules），
      // 不能让插件子进程从自己临时的安装目录去找 @napi-rs/canvas。
      pluginRuntimeDeps: {
        packages: ['@napi-rs/canvas'],
        baseUrl: pathToFileURL(join(process.cwd(), 'package.json')).href
      }
    })
    await service.attachCapabilityRegistry(registry)
    return service
  }
  const service = await createService()
  await service.initialize()
  const holder = { current: service }
  const installServicePort = {
    installFromDirectory: (directory, contract) => holder.current.installFromDirectory(directory, contract),
    uninstall: (packageName) => holder.current.uninstall(packageName),
    refreshDiscoveredPlugins: () => holder.current.refreshDiscoveredPlugins()
  }
  const installDeps = {
    installedRoot,
    stagingRoot: join(userData, 'extensions', 'staging'),
    policyPath,
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    hostApiRange: '^1.0.0',
    hostProvidedDependencies: HOST_PROVIDED,
    publisherKeyring,
    service: installServicePort
  }

  const installed = await installDshPluginArtifact(installDeps, {
    artifactPath: packed.artifact,
    expectedSha256: packed.sha256,
    approvedToolNames,
    source: 'plugin-verify'
  }, emptyDshPluginPolicy())
  const listed = (await holder.current.list()).find((entry) => entry.packageName === packageJson.name)
  assert(listed?.enabled === true, 'the installer left the plugin disabled')
  step('install + activate', {
    packageName: installed.packageName,
    version: installed.version,
    directory: installed.installedDirectory.split('/').pop(),
    enabled: listed.enabled
  })

  // 4. The Host exposes the capability while it is enabled.
  await waitFor(
    () => registry.get(capabilityId) !== undefined,
    `the Host registry does not expose ${capabilityId} while enabled (waited 5s)`
  )
  const approval = (await readDshPluginPolicy(policyPath)).approved.find((entry) => entry.packageName === packageJson.name)
  step('host registry exposes the capability', {
    capabilityId,
    registered: true,
    publisherId: approval?.publisherId ?? null,
    approvedTools: Object.keys(approval?.tools ?? {})
  })

  const grants = Object.fromEntries(
    Object.entries(artifact.manifest.tools).map(([name, grant]) => [name, { id: grant.id, effect: grant.effect }])
  )
  const agentResolver = await ensureDshAgentResolverModule(root)
  const invokeOn = async (entryPath) => {
    const host = new ProcessExtensionHost({
      invokeTimeoutMs: HOST_BUSINESS_INVOKE_TIMEOUT_MS,
      resolveDshToolGrants: () => grants,
      resolveDshConfig: () => ({}),
      dshAgentResolver: agentResolver,
      authorizeDshTool: () => undefined,
      // 与 app / install-acceptance 一致：调用侧的宿主同样要代解析原生依赖
      pluginRuntimeDeps: {
        packages: ['@napi-rs/canvas'],
        baseUrl: pathToFileURL(join(process.cwd(), 'package.json')).href
      }
    })
    const snapshot = await host.replace({
      pluginId: packageJson.name,
      packageName: packageJson.name,
      version: artifact.manifest.version,
      entryPath
    })
    const runtime = host.runtime(packageJson.name)
    assert(runtime, 'no runtime was created for the installed plugin')
    const invocation = Object.freeze({
      caller: {},
      ordinarySession: Object.freeze({ runtimeId: 'verify-runtime', threadId: 'thread-1', sessionId: 'session-1' }),
      context: {}
    })
    const invoke = async (input) => {
      const result = await runtime.invoke(capabilityId, input, undefined, undefined, undefined, invocation)
      return result.output
    }
    return { host, snapshot, invoke }
  }

  // 5. Real calls with different inputs, against the INSTALLED directory.
  const installedEntry = join(installed.installedDirectory, artifact.manifest.entry)
  const first = await invokeOn(installedEntry)
  const outputs = []
  try {
    for (const input of inputs) {
      outputs.push(await first.invoke(input))
    }
  } finally {
    await first.host.disposeAll().catch(() => undefined)
  }
  assert(outputs.every((output) => output && output.ok === true), `a call failed: ${JSON.stringify(outputs)}`)
  assert(
    JSON.stringify(outputs[0].result) !== JSON.stringify(outputs[1].result),
    'two different inputs produced identical results, which cannot be right'
  )
  step('real calls follow the input', {
    capabilityId,
    inputs: inputs.map((input) => JSON.stringify(input)),
    outputs: outputs.map((output) => JSON.stringify(output.result).slice(0, 300))
  })

  // 6. Refusals. Two different boundaries:
  //    (a) an argument that violates the declared parameter schema is refused by
  //        the host before the plugin ever runs;
  //    (b) an argument that passes the schema but is out of range is refused by
  //        the plugin itself, with its own structured code.
  if (invalidInput !== undefined) {
    const refused = await invokeOn(installedEntry)
    let hostRefusal
    let result
    try {
      result = await refused.invoke(invalidInput)
    } catch (error) {
      hostRefusal = error
    } finally {
      await refused.host.disposeAll().catch(() => undefined)
    }
    assert(
      hostRefusal !== undefined || (result && result.ok === false),
      `an input violating the declared parameters was accepted: ${JSON.stringify(result)}`
    )
    step('argument outside the declared schema is refused', {
      input: JSON.stringify(invalidInput),
      refusedBy: hostRefusal ? 'host parameter validation' : 'plugin',
      error: hostRefusal ? String(hostRefusal.message).slice(0, 200) : result.error
    })
  }

  // Oversized inputs are built here rather than passed through argv: a megabyte
  // of command-line argument is not portable, and it blew the process up once.
  const boundaryInput = process.argv.includes('--boundary-oversized-text')
    ? { text: 'a'.repeat(1_000_001) }
    : flag('boundary-args') === undefined ? undefined : JSON.parse(flag('boundary-args'))
  const expectedBoundaryCode = flag('expect-boundary-code') ?? 'invalid_request'
  if (boundaryInput !== undefined) {
    const boundary = await invokeOn(installedEntry)
    let result
    try {
      result = await boundary.invoke(boundaryInput)
    } finally {
      await boundary.host.disposeAll().catch(() => undefined)
    }
    assert(result && result.ok === false, `the plugin accepted an out-of-range input: ${JSON.stringify(result)}`)
    assert(
      result.error?.code === expectedBoundaryCode,
      `expected refusal code ${expectedBoundaryCode}, got ${String(result.error?.code)}`
    )
    step('out-of-range input refused by the plugin itself', { error: result.error })
  }

  // 7. A real restart must still be able to CALL it (not merely list it).
  await holder.current.dispose().catch(() => undefined)
  holder.current = await createService()
  await holder.current.initialize()
  const afterRestart = (await holder.current.list()).find((entry) => entry.packageName === packageJson.name)
  assert(afterRestart?.enabled === true, 'the plugin did not come back enabled after restart')
  await waitFor(
    () => registry.get(capabilityId) !== undefined,
    `the Host registry lost ${capabilityId} after restart (waited 5s)`
  )
  const restarted = await invokeOn(installedEntry)
  let restartedOutput
  try {
    restartedOutput = await restarted.invoke(inputs[0])
  } finally {
    await restarted.host.disposeAll().catch(() => undefined)
  }
  assert(restartedOutput?.ok === true, 'the capability could not be called after a restart')
  assert(
    JSON.stringify(restartedOutput.result) === JSON.stringify(outputs[0].result),
    'the post-restart result differs from the pre-restart result for the same input'
  )
  step('restart keeps it callable', {
    enabled: afterRestart.enabled,
    registered: true,
    capabilityId,
    sameResultAsBeforeRestart: true
  })

  // 8. Disable withdraws the capability from the Host.
  await holder.current.setEnabled(packageJson.name, false)
  const disabled = (await holder.current.list()).find((entry) => entry.packageName === packageJson.name)
  assert(disabled?.enabled === false, 'disable did not take effect')
  assert(registry.get(capabilityId) === undefined, `${capabilityId} is still exposed while disabled`)
  step('disable withdraws the capability', { enabled: disabled.enabled, registered: false })

  // 9. Re-enable and call again.
  await holder.current.setEnabled(packageJson.name, true)
  assert(registry.get(capabilityId) !== undefined, `${capabilityId} was not re-registered on re-enable`)
  const reenabled = await invokeOn(installedEntry)
  let reenabledOutput
  try {
    reenabledOutput = await reenabled.invoke(inputs[0])
  } finally {
    await reenabled.host.disposeAll().catch(() => undefined)
  }
  assert(reenabledOutput?.ok === true, 'the capability failed after re-enabling')
  step('re-enable restores it', { registered: true, ok: reenabledOutput.ok })

  // 10. Uninstall removes the directory, the approval and the capability.
  await uninstallDshPlugin(installDeps, packageJson.name, await readDshPluginPolicy(policyPath))
  let directoryGone = false
  try {
    await stat(installed.installedDirectory)
  } catch {
    directoryGone = true
  }
  assert(directoryGone, 'the plugin directory survived uninstall')
  assert(registry.get(capabilityId) === undefined, `${capabilityId} is still exposed after uninstall`)
  const policyAfter = await readDshPluginPolicy(policyPath)
  assert(!policyAfter.approved.some((entry) => entry.packageName === packageJson.name), 'the approval survived uninstall')
  step('uninstall leaves nothing behind', { directoryGone: true, registered: false, approvals: policyAfter.approved.length })

  // 11. Another restart loads nothing.
  await holder.current.dispose().catch(() => undefined)
  holder.current = await createService()
  await holder.current.initialize()
  const afterUninstall = (await holder.current.list()).find((entry) => entry.packageName === packageJson.name)
  assert(afterUninstall === undefined, 'the plugin is listed again after uninstall + restart')
  assert(registry.get(capabilityId) === undefined, `${capabilityId} came back after uninstall + restart`)
  step('restart after uninstall loads nothing', { listed: false, registered: false })

  await holder.current.dispose().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ ok: true, plugin: packageJson.name, capabilityId, steps }, null, 2)}\n`)
  process.exit(0)
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, steps }, null, 2)}\n`)
  process.exit(1)
})