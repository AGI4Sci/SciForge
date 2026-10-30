/**
 * Builds `market/index.json` — the single published catalog the website and the
 * in-app market both read — from the batch pass over the official plugins.
 *
 * Admission rule (enforced here, not by convention):
 *   A plugin is listed as installable only when its artifact really declares its
 *   own tool grants and effects, the host activated it, and every host dependency
 *   it asks for is one this build provides. A plugin that builds and activates
 *   but declares nothing is NOT a product: installing it would grant nothing and
 *   hide what it does. Those are published in `blocked` with the reason, so the
 *   market can say "not installable yet" instead of showing a fake listing.
 *
 * Usage: node --import tsx scripts/dsh-plugin-market-index.mjs [--json]
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const INDEX_PATH = resolve(process.env.SCIFORGE_MARKET_INDEX_OUT?.trim() || 'market/index.json')
const BATCH_REPORT_PATH = resolve(process.env.SCIFORGE_MARKET_WORK_DIR?.trim() || '.tmp/market-work', 'batch-report.json')
const HOST_PROVIDED = new Set(['@deepseek-ai/dsh-tools', '@napi-rs/canvas'])

/**
 * Bundled capability ids the application already provides. A plugin that
 * re-registers one of these cannot activate in the real app ("Capability … is
 * already registered"), so it is not installable no matter how well it packages.
 * Extracted from the bundled domain sources rather than hard-coded, so the gate
 * tracks the app.
 */
export async function bundledCapabilityIds(root = resolve('packages/domains')) {
  const ids = new Set()
  const { readdir, readFile } = await import('node:fs/promises')
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        const text = await readFile(path, 'utf8')
        for (const match of text.matchAll(/'([a-z][a-z0-9-]*\.[a-z0-9-]+(?:\.[a-z0-9-]+)*)'/g)) {
          ids.add(match[1])
        }
      }
    }
  }
  try {
    await walk(root)
  } catch {
    return ids
  }
  return ids
}

/**
 * The index is publishable output: a reason that names a machine-local absolute
 * path (an ENOENT from a packaging run, say) must not travel into a published
 * catalogue or into the app's market panel.
 */
function publishable(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/\/(?:Users|home|private|var|tmp|opt)[^\s'"]*/g, '<local-path>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function admissionFor(record, bundledIds = new Set()) {
  if (!record.artifact) return `no artifact: ${record.reason ?? 'packaging did not run'}`
  if (record.artifact.tools.length === 0) {
    return 'artifact declares no tool grants, so installing it would grant nothing and hide what it does.'
  }
  const missing = record.artifact.hostDependencies.filter((dependency) => !HOST_PROVIDED.has(dependency))
  if (missing.length > 0) return `artifact requires host packages this build does not provide: ${missing.join(', ')}`
  if (record.activated !== true) return `the host did not activate it: ${record.reason ?? 'unknown reason'}`
  if (record.artifact.publisherId === null) return 'artifact carries no trusted publisher signature.'
  const collisions = record.artifact.capabilityIds.filter((id) => bundledIds.has(id))
  if (collisions.length > 0) {
    return `capability ids are already provided by bundled domains, so activating it in this application collides: ${collisions.join(', ')}`
  }
  return null
}

export async function indexFromBatchReport(report, readArtifact, bundledIds = new Set()) {
  const plugins = []
  const blocked = []
  const byName = new Map(report.catalogEntries.map((entry) => [entry.name, entry]))
  for (const record of report.plugins) {
    if (!record.artifact) {
      blocked.push({
        name: record.packageName,
        plugin: record.plugin,
        version: record.version,
        reason: publishable(`no artifact: ${record.reason ?? 'packaging did not run'}`),
        detail: publishable(record.reason ?? '') || null,
        runtimeGap: publishable(record.runtimeGap ?? '') || null
      })
      continue
    }
    // Read the artifact through the same validator the installer uses: the
    // published permissions must be the artifact's own digests-verified claims,
    // not a copy of whatever the packaging step happened to print.
    const validated = await readArtifact(record.artifact.path)
    const tools = Object.entries(validated.manifest.tools)
      .map(([name, grant]) => ({ name, id: grant.id, effect: grant.effect }))
      .sort((left, right) => left.name.localeCompare(right.name))
    const enriched = {
      ...record,
      artifact: {
        ...record.artifact,
        tools,
        capabilityIds: tools.map((tool) => tool.id),
        hostDependencies: validated.manifest.hostDependencies
      }
    }
    const refusal = admissionFor(enriched, bundledIds)
    if (refusal) {
      blocked.push({
        name: record.packageName,
        plugin: record.plugin,
        version: record.version,
        reason: publishable(refusal),
        detail: publishable(record.reason ?? '') || null,
        runtimeGap: publishable(record.runtimeGap ?? '') || null
      })
      continue
    }
    const declared = byName.get(record.packageName) ?? {}
    plugins.push({
      name: record.packageName,
      title: declared.title ?? record.plugin,
      version: record.version,
      form: 'dsh-runtime',
      categories: declared.categories ?? [],
      entry: validated.manifest.entry,
      tools,
      hostDependencies: validated.manifest.hostDependencies,
      publisher: record.artifact.publisherId,
      artifact: {
        file: record.artifact.path.split('/').pop(),
        sizeBytes: record.artifact.sizeBytes,
        sha256: record.artifact.sha256
      },
      source: `plugins/${record.plugin}`,
      runtimeNote: record.runtimeGap ?? null
    })
  }
  plugins.sort((left, right) => left.name.localeCompare(right.name))
  blocked.sort((left, right) => left.name.localeCompare(right.name))
  return {
    format: 1,
    generatedAt: new Date().toISOString(),
    dshRuntimeVersion: report.dshRuntimeVersion,
    plugins,
    blocked
  }
}

/**
 * Copies the admitted artifacts next to the index. A published catalog and its
 * artifacts travel together, so one relative path works from a checkout and from
 * a static host.
 */
async function publishArtifacts(index) {
  const artifactsDir = resolve(process.env.SCIFORGE_MARKET_ARTIFACTS_OUT?.trim() || 'market/artifacts')
  await mkdir(artifactsDir, { recursive: true })
  const report = JSON.parse(await readFile(BATCH_REPORT_PATH, 'utf8'))
  const byName = new Map(report.plugins.map((record) => [record.packageName, record]))
  for (const plugin of index.plugins) {
    const record = byName.get(plugin.name)
    await copyFile(record.artifact.path, join(artifactsDir, plugin.artifact.file))
  }
  return artifactsDir
}

/**
 * The two demo plugins are test fixtures now (tests/fixtures/dsh-plugins). Their
 * catalogue is signed with a repository-external *test* key, so it must never be
 * written over the product catalogue that ships inside the app. Refuse that
 * combination outright instead of trusting the caller to pass matching paths.
 */
function assertProductCatalogueIsNotBuiltFromFixtures() {
  const pluginsRoot = process.env.SCIFORGE_PLUGINS_DIR?.trim()
  if (!pluginsRoot) return
  if (resolve(pluginsRoot) === resolve('plugins')) return
  if (INDEX_PATH === resolve('market/index.json')) {
    throw new Error(
      `Refusing to write the product catalogue ${INDEX_PATH} from ${pluginsRoot}. ` +
      'Fixtures are test-only; set SCIFORGE_MARKET_INDEX_OUT to a fixture path (npm run market:fixtures does this).'
    )
  }
}

async function main() {
  assertProductCatalogueIsNotBuiltFromFixtures()
  // Runs under tsx so publishing reads artifacts with the installer's validator.
  const { readDshPluginArtifact } = await import(
    new URL('../src/main/extensions/dsh-plugin-artifact.ts', import.meta.url).href
  )
  const report = JSON.parse(await readFile(BATCH_REPORT_PATH, 'utf8'))
  const bundledIds = await bundledCapabilityIds()
  const index = await indexFromBatchReport(report, (path) => readDshPluginArtifact(path), bundledIds)
  process.stdout.write(`bundled capability ids considered: ${bundledIds.size}\n`)
  await mkdir(dirname(INDEX_PATH), { recursive: true })
  await writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`)
  const artifactsDir = await publishArtifacts(index)
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(index, null, 2)}\n`)
    return
  }
  process.stdout.write(`installable: ${index.plugins.length}, not installable: ${index.blocked.length}\n`)
  for (const plugin of index.plugins) {
    process.stdout.write(`  ✓ ${plugin.name}@${plugin.version} — ${plugin.tools.length} tools\n`)
  }
  for (const plugin of index.blocked) {
    process.stdout.write(`  ✗ ${plugin.name} — ${plugin.reason}\n`)
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}