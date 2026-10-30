/**
 * Market acceptance: the whole path a user takes, exercised through the market
 * module rather than through the installer directly.
 *
 *   read the published index → pick a listed plugin → check the catalog digest
 *   → verify the publisher signature → stage and swap → activate → restart
 *   → disable → uninstall
 *
 * The keyring is host configuration, passed in by path (never in the repository),
 * and the profile is a throwaway directory, so nothing here touches a real user
 * profile or a production key.
 *
 * Usage:
 *   node --import tsx scripts/dsh-plugin-market-acceptance.mjs \
 *     --index market/index.json --keyring <keys.json> [--json]
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const HOST_API_VERSION = '1.0.0'
const steps = []

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function step(name, detail) {
  steps.push({ step: name, ok: true, detail })
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? fallback : process.argv[index + 1]
}

async function main() {
  const indexSource = argument('index', 'market/index.json')
  const keyringPath = argument('keyring', process.env.SCIFORGE_TEST_PUBLISHER_KEYRING)
  if (!keyringPath) throw new Error('--keyring is required: publisher trust is host configuration.')

  const {
    readDshMarketIndex,
    installDshMarketPlugin,
    uninstallDshMarketPlugin,
    resolveDshMarketSource
  } = await import(pathToFileURL(resolve('src/main/extensions/dsh-plugin-market.ts')).href)
  const { loadDshPublisherKeyring } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-signature.ts')).href
  )
  const { emptyDshPluginPolicy, policyContracts, readDshPluginPolicy } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-policy.ts')).href
  )
  const { DevelopmentExternalPluginService } = await import(
    pathToFileURL(resolve('src/main/extensions/development-external-plugins.ts')).href
  )

  const source = resolveDshMarketSource({ configured: indexSource, env: process.env })
  assert(source, 'the market index could not be resolved')
  const index = await readDshMarketIndex(source)
  const target = index.plugins[0]
  assert(target, 'the published index lists no installable plugin')
  step('reads the published market index', {
    installable: index.plugins.map((plugin) => `${plugin.name}@${plugin.version}`),
    notInstallable: index.blocked.length
  })

  const root = await mkdtemp(join(tmpdir(), 'dsh-market-'))
  const userData = join(root, 'profile')
  const installedRoot = join(userData, 'extensions', 'plugin-packages')
  const policyPath = join(userData, 'extensions', 'dsh-plugin-policy.json')
  await mkdir(installedRoot, { recursive: true })
  const publisherKeyring = await loadDshPublisherKeyring(resolve(keyringPath))
  assert(publisherKeyring.keys.size > 0, 'the host keyring trusts no publisher, so nothing can be installed')

  const createService = async () => new DevelopmentExternalPluginService({
    root: installedRoot,
    userDataPath: userData,
    hostApiVersion: HOST_API_VERSION,
    dshRuntimeVersion: index.dshRuntimeVersion,
    adapterContracts: policyContracts(await readDshPluginPolicy(policyPath)),
    allowedPermissionIds: new Set(),
    pluginRuntimeDeps: {
      packages: ['@napi-rs/canvas'],
      baseUrl: pathToFileURL(join(process.cwd(), 'package.json')).href
    },
    ...(process.env.SCIFORGE_ACCEPTANCE_PLOTTING_PYTHON
      ? { pluginRuntimeEnv: { SCIFORGE_PYTHON: process.env.SCIFORGE_ACCEPTANCE_PLOTTING_PYTHON } }
      : {})
  })
  let service = await createService()
  await service.initialize()
  const holder = { current: service }

  const progress = []
  const deps = {
    source,
    cacheDir: join(root, 'cache'),
    installDeps: {
      installedRoot,
      stagingRoot: join(userData, 'extensions', 'staging'),
      policyPath,
      dshRuntimeVersion: index.dshRuntimeVersion,
      hostApiRange: '^1.0.0',
      hostProvidedDependencies: new Set(['@deepseek-ai/dsh-tools', '@napi-rs/canvas']),
      publisherKeyring,
      service: {
        installFromDirectory: (directory, contract) => holder.current.installFromDirectory(directory, contract),
        uninstall: (packageName) => holder.current.uninstall(packageName),
        refreshDiscoveredPlugins: () => holder.current.refreshDiscoveredPlugins()
      }
    },
    onProgress: (entry) => progress.push(entry.phase)
  }

  // The catalog must not be able to widen what the user approved.
  let widened
  try {
    await installDshMarketPlugin(deps, { packageName: target.name, approvedToolNames: [...target.tools.map((tool) => tool.name), 'extra.tool'] })
  } catch (error) {
    widened = error
  }
  assert(widened, 'the market accepted an approval list that does not match the declared tools')
  assert(/does not match what/.test(widened.message), `unexpected refusal: ${widened.message}`)
  step('refuses an approval list that does not match the declaration', { error: widened.message.slice(0, 160) })

  const outcome = await installDshMarketPlugin(deps, {
    packageName: target.name,
    approvedToolNames: target.tools.map((tool) => tool.name)
  })
  step('installs the listed plugin through the market', {
    packageName: outcome.packageName,
    version: outcome.version,
    sha256: outcome.sha256,
    tools: outcome.tools,
    phases: progress
  })
  assert((await stat(outcome.installedDirectory)).isDirectory(), 'the plugin directory was not created')

  const listed = (await holder.current.list()).find((entry) => entry.packageName === target.name)
  assert(listed?.enabled === true, 'the market install left the plugin disabled')
  const policy = await readDshPluginPolicy(policyPath)
  const approval = policy.approved.find((entry) => entry.packageName === target.name)
  assert(approval, 'the market install recorded no approval')
  assert(approval.publisherId === target.publisher, `approval recorded publisher ${String(approval.publisherId)} instead of ${String(target.publisher)}`)
  assert(approval.tools && Object.keys(approval.tools).length === target.tools.length, 'the approval does not cover every declared tool')
  step('records the approval bound to the trusted publisher', {
    publisherId: approval.publisherId,
    tools: Object.keys(approval.tools ?? {})
  })

  // A tampered artifact must be refused by the market digest check, and must not
  // disturb what is already installed. The published copy is never modified.
  const artifactPath = join(dirname(source.path), 'artifacts', target.artifact.file)
  const tamperDir = join(root, 'tampered-market')
  await mkdir(join(tamperDir, 'artifacts'), { recursive: true })
  const tamperIndex = join(tamperDir, 'index.json')
  await writeFile(tamperIndex, await readFile(source.path))
  const tamperedBytes = Buffer.from(await readFile(artifactPath))
  tamperedBytes[tamperedBytes.length - 20] ^= 0xff
  await writeFile(join(tamperDir, 'artifacts', target.artifact.file), tamperedBytes)
  let tampered
  try {
    await installDshMarketPlugin({ ...deps, source: { kind: 'file', path: tamperIndex } }, {
      packageName: target.name,
      approvedToolNames: target.tools.map((tool) => tool.name)
    })
  } catch (error) {
    tampered = error
  }
  assert(tampered, 'a byte-tampered artifact was accepted')
  assert(
    /does not match the published digest/.test(tampered.message),
    `the tampered artifact was refused for an unexpected reason: ${tampered.message}`
  )
  const survivor = (await holder.current.list()).find((entry) => entry.packageName === target.name)
  assert(survivor?.enabled === true, 'the refused install disturbed the working plugin')
  step('refuses a byte-tampered artifact', { error: tampered.message.slice(0, 160) })

  // Restart must restore the approval from host policy, not from memory.
  await holder.current.dispose().catch(() => undefined)
  service = await createService()
  holder.current = service
  await service.initialize()
  const afterRestart = (await service.list()).find((entry) => entry.packageName === target.name)
  assert(afterRestart?.enabled === true, 'the plugin did not survive a restart')
  step('survives a restart', { enabled: afterRestart.enabled })

  await holder.current.setEnabled(target.name, false)
  const disabled = (await holder.current.list()).find((entry) => entry.packageName === target.name)
  assert(disabled && disabled.enabled === false, 'disable did not take effect')
  step('disables through the market surface', { enabled: disabled.enabled })

  await uninstallDshMarketPlugin(deps, target.name)
  const gone = (await holder.current.list()).find((entry) => entry.packageName === target.name)
  assert(!gone, 'the plugin is still listed after uninstall')
  const policyAfter = await readDshPluginPolicy(policyPath)
  assert(!policyAfter.approved.some((entry) => entry.packageName === target.name), 'the approval survived uninstall')
  step('uninstalls and clears the approval', { remainingApprovals: policyAfter.approved.length })

  await service.dispose().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ ok: true, index: source, steps }, null, 2)}\n`)
  // The plugin child processes are disposed above; exit explicitly so a stray
  // handle cannot keep a finished acceptance run alive.
  process.exit(0)
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stdout.write(`${JSON.stringify({ ok: false, error: message, steps }, null, 2)}\n`)
  process.exitCode = 1
})