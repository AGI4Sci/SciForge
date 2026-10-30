/**
 * Batch pass over the official plugins: build, pack (signed), validate, and
 * install each one into a throwaway profile to see whether the host actually
 * activates it.
 *
 * What this script does NOT do: claim a plugin works because it activated. A
 * plugin that activates but cannot be called is reported as activation-only, with
 * the reason (missing host capability, Python runtime, adapter input). Real
 * functional invocation is proven separately by the end-to-end acceptance run.
 *
 * Usage: node --import tsx scripts/dsh-plugin-market-batch.mjs [--json]
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const { ensureMarketWorkDir } = await import('./market-work-dir.mjs')

const HOST_API_VERSION = '1.0.0'
const DSH_RUNTIME_VERSION = '0.2.0-rc.2'
const HOST_PROVIDED = new Set(['@deepseek-ai/dsh-tools', '@napi-rs/canvas'])
/** Plugins whose real execution needs host capabilities the build does not have. */
const KNOWN_RUNTIME_GAPS = Object.freeze({
  'evidence-dag': 'Needs the Evidence Python wheel and the host artifact-version service (G1); activation only here.',
  'project-dag': 'Needs the Project Python runtime and the host Project service (G1); activation only here.',
  'git-checkpoints': 'Needs host version-control capabilities (G1); activation only here.',
  'research-checkpoints': 'Needs the host artifact-version service (G1); activation only here.',
  'scientific-plotting': 'Renders real PNGs; the end-to-end acceptance script invokes it for real.',
  'change-inspector': 'Investigation tools need a workspace with real changes; activation only here.',
  'biology-room': 'Adapter-provided UI and inputs; activation only here.',
  'life-science-preview': 'Adapter-provided preview inputs; activation only here.',
  'visual-review': 'Adapter-provided review inputs; activation only here.'
})

async function resolveTestPublisherKey({ keyDir, generate }) {
  if (!keyDir) {
    throw new Error('The batch pass needs --key-dir: test keys must live outside the repository and be reused across runs.')
  }
  const directory = resolve(keyDir)
  await mkdir(directory, { recursive: true })
  const keyId = 'market-publisher-key'
  const publisherId = 'sciforge-market'
  const keyringPath = join(directory, 'dsh-publisher-keys.json')
  const privateKeyPath = join(directory, `${keyId}.private.pem`)
  try {
    await readFile(privateKeyPath)
    await readFile(keyringPath)
    return { keyId, publisherId, privateKeyPath, keyringPath }
  } catch {
    const generated = await generate({ outDir: directory, keyId, publisherId })
    return { keyId, publisherId, privateKeyPath: generated.privateKeyPath, keyringPath: generated.keyringPath }
  }
}

async function main() {
  const json = process.argv.includes('--json')
  const keyDirFlag = process.argv.indexOf('--key-dir')
  const keyDir = keyDirFlag < 0 ? process.env.SCIFORGE_TEST_KEY_DIR : process.argv[keyDirFlag + 1]
  const artifactDir = resolve(await ensureMarketWorkDir(), 'artifacts')
  await mkdir(artifactDir, { recursive: true })
  const root = await mkdtemp(join(tmpdir(), 'dsh-batch-'))

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
  const { installDshPluginArtifact } = await import(
    pathToFileURL(resolve('src/main/extensions/dsh-plugin-install.ts')).href
  )
  const { DevelopmentExternalPluginService } = await import(
    pathToFileURL(resolve('src/main/extensions/development-external-plugins.ts')).href
  )

  const testKey = await resolveTestPublisherKey({ keyDir, generate: generatePublisherKeypair })
  const publisherKeyring = await loadDshPublisherKeyring(testKey.keyringPath)

  const entries = []
  const results = []
  for (const directory of await listPluginDirectories()) {
    const manifestRaw = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    const label = directory.split('/').pop()
    const record = {
      plugin: label,
      packageName: manifestRaw.name,
      version: manifestRaw.version,
      declared: manifestRaw.dsh !== undefined,
      build: 'not-run',
      artifact: null,
      activated: null,
      status: 'unknown',
      reason: null,
      runtimeGap: KNOWN_RUNTIME_GAPS[label] ?? null
    }
    results.push(record)

    if (manifestRaw.dsh === undefined) {
      record.status = 'blocked'
      record.reason = 'package.json declares no DSH plugin form, so it cannot be packaged without inventing a declaration.'
      continue
    }

    try {
      const build = await execFileAsync('npm', ['run', 'build'], {
        cwd: resolve(directory),
        maxBuffer: 32 * 1024 * 1024,
        timeout: 600_000
      })
      record.build = 'ok'
      record.buildOutput = build.stdout.trim().split('\n').slice(-2).join(' | ')
    } catch (error) {
      record.build = 'failed'
      record.status = 'blocked'
      record.reason = `build failed: ${(error.stderr ?? error.message).toString().trim().split('\n').slice(-3).join(' | ')}`
      continue
    }

    try {
      const packed = await packDshPlugin({
        source: directory,
        outDir: artifactDir,
        signingKeyPath: testKey.privateKeyPath,
        keyId: testKey.keyId,
        publisherId: testKey.publisherId
      })
      const validated = await readDshPluginArtifact(packed.artifact)
      record.artifact = {
        path: packed.artifact,
        sizeBytes: packed.sizeBytes,
        sha256: packed.sha256,
        fileCount: packed.fileCount,
        entry: validated.manifest.entry,
        tools: Object.keys(validated.manifest.tools),
        hostDependencies: validated.manifest.hostDependencies,
        publisherId: packed.signature?.publisherId ?? null
      }
      entries.push(packed.catalogEntry)
    } catch (error) {
      record.status = 'blocked'
      record.reason = `packaging failed: ${error instanceof Error ? error.message : String(error)}`
      continue
    }

    // One throwaway profile per plugin: activation must not depend on whatever
    // another plugin left in the shared root.
    const profile = join(root, 'profiles', label)
    const installedRoot = join(profile, 'extensions', 'plugin-packages')
    const policyPath = join(profile, 'extensions', 'dsh-plugin-policy.json')
    const service = new DevelopmentExternalPluginService({
      root: installedRoot,
      userDataPath: profile,
      hostApiVersion: HOST_API_VERSION,
      dshRuntimeVersion: DSH_RUNTIME_VERSION,
      adapterContracts: policyContracts(await readDshPluginPolicy(policyPath)),
      allowedPermissionIds: new Set(),
      pluginRuntimeDeps: {
        packages: ['@napi-rs/canvas'],
        baseUrl: pathToFileURL(join(process.cwd(), 'package.json')).href
      }
    })
    await service.initialize()
    try {
      const installed = await installDshPluginArtifact({
        installedRoot,
        stagingRoot: join(profile, 'extensions', 'staging'),
        policyPath,
        dshRuntimeVersion: DSH_RUNTIME_VERSION,
        hostApiRange: '^1.0.0',
        hostProvidedDependencies: HOST_PROVIDED,
        publisherKeyring,
        service
      }, {
        artifactPath: record.artifact.path,
        expectedSha256: record.artifact.sha256,
        approvedToolNames: record.artifact.tools,
        source: 'batch'
      }, emptyDshPluginPolicy())
      const listed = (await service.list()).find((entry) => entry.packageName === record.packageName)
      record.activated = listed?.enabled === true
      record.status = record.activated ? 'activation-only' : 'blocked'
      if (!record.activated) record.reason = 'the host did not activate the installed plugin.'
      record.collectedRevision = listed?.version ?? null
      void installed
    } catch (error) {
      record.activated = false
      record.status = 'blocked'
      record.reason = `activation failed: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      await service.dispose().catch(() => undefined)
    }
  }

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    dshRuntimeVersion: DSH_RUNTIME_VERSION,
    artifacts: results.filter((record) => record.artifact !== null).length,
    activationOnly: results.filter((record) => record.status === 'activation-only').length,
    blocked: results.filter((record) => record.status === 'blocked').length,
    plugins: results,
    catalogEntries: entries
  }
  await writeFile(resolve(await ensureMarketWorkDir(), 'batch-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    await rm(root, { recursive: true, force: true })
    return
  }
  process.stdout.write(`${['plugin', 'build', 'artifact', 'activated', 'status'].join('\t')}\n`)
  for (const record of results) {
    process.stdout.write([
      record.plugin,
      record.build,
      record.artifact ? `${Math.round(record.artifact.sizeBytes / 1024)}KB` : '-',
      String(record.activated),
      record.status
    ].join('\t') + '\n')
    if (record.reason) process.stdout.write(`\t\t└─ ${record.reason}\n`)
  }
  await rm(root, { recursive: true, force: true })
}

async function listPluginDirectories() {
  const pluginsDirectory = resolve(process.env.SCIFORGE_PLUGINS_DIR?.trim() || 'plugins')
  const directories = []
  for (const entry of await readdir(pluginsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'templates') continue
    try {
      await readFile(join(pluginsDirectory, entry.name, 'package.json'))
      directories.push(join(pluginsDirectory, entry.name))
    } catch {
      // A directory without a package.json is not a plugin.
    }
  }
  return directories.sort()
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})