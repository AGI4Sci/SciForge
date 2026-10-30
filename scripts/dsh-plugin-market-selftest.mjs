/**
 * Builds a self-test plugin and a local market index containing only that plugin.
 *
 * Why this exists: every official plugin in this repository migrates capabilities
 * that the application already ships as bundled domains, so installing one
 * collides with the bundled registration and activation is refused. That is a
 * host-policy question (may a plugin supersede a bundled domain?) and must not be
 * papered over.
 *
 * To verify the market chain in the real application, this script produces a
 * plugin with capability ids that collide with nothing, signs it with the
 * repository-external test key, and writes a local index. The published index is
 * untouched: this fixture is a test instrument, never a product.
 *
 * Usage:
 *   node --import tsx scripts/dsh-plugin-market-selftest.mjs --key-dir <dir> [--json]
 */
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const OUT = resolve(process.env.SCIFORGE_MARKET_WORK_DIR?.trim() || '.tmp/market-work', 'selftest')
const PLUGIN_DIR = join(OUT, 'plugin')
const MARKET_DIR = join(OUT, 'market')
const PACKAGE_NAME = '@sciforge/plugin-market-selftest'
const CAPABILITY_ID = 'market-selftest.ping'

async function main() {
  const keyDirFlag = process.argv.indexOf('--key-dir')
  const keyDir = keyDirFlag < 0 ? process.env.SCIFORGE_TEST_KEY_DIR : process.argv[keyDirFlag + 1]
  if (!keyDir) throw new Error('--key-dir is required: signing uses the repository-external test key.')

  const { packDshPlugin } = await import(pathToFileURL(resolve('scripts/dsh-plugin-package.mjs')).href)
  const { generatePublisherKeypair } = await import(pathToFileURL(resolve('scripts/dsh-plugin-package.mjs')).href)

  const keys = resolve(keyDir)
  await mkdir(keys, { recursive: true })
  const keyId = 'market-publisher-key'
  const publisherId = 'sciforge-market'
  const privateKeyPath = join(keys, `${keyId}.private.pem`)
  const keyringPath = join(keys, 'dsh-publisher-keys.json')
  try {
    await import('node:fs/promises').then((fs) => fs.readFile(privateKeyPath))
  } catch {
    await generatePublisherKeypair({ outDir: keys, keyId, publisherId })
  }

  await rm(OUT, { recursive: true, force: true })
  await mkdir(join(PLUGIN_DIR, 'dist'), { recursive: true })

  await writeFile(join(PLUGIN_DIR, 'package.json'), `${JSON.stringify({
    name: PACKAGE_NAME,
    version: '0.1.0',
    type: 'module',
    private: true,
    exports: { '.': { import: './dist/main.js' } },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    engines: { dsh: '>=0.2.0-rc.2 <0.3.0' }
  }, null, 2)}\n`)

  await writeFile(join(PLUGIN_DIR, 'cordis.patch.yml'), `- insert:\n    - id: market-selftest\n      name: "${PACKAGE_NAME}"\n`)

  await writeFile(join(PLUGIN_DIR, 'sciforge.dsh.json'), `${JSON.stringify({
    schemaVersion: 1,
    packageName: PACKAGE_NAME,
    entry: 'dist/main.js',
    title: 'Market self-test',
    summary: {
      zh: '市场自检插件：仅用于验证安装链路，能力 id 与内置域不冲突，不作为商品上架。',
      en: 'Market self-test plugin: verifies the install chain only, collides with no bundled capability, and is never published as a product.'
    },
    categories: ['selftest'],
    hostDependencies: ['@deepseek-ai/dsh-tools'],
    tools: {
      // The key must be the REGISTERED tool name: the host resolves grants by
      // tool name, and a mismatch fails closed as "no approved effect grant".
      market_selftest_ping: { id: CAPABILITY_ID, effect: 'read' }
    }
  }, null, 2)}\n`)

  await writeFile(join(PLUGIN_DIR, 'dist/main.js'), `import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'market_selftest_ping',
    description: 'Market self-test capability. Returns a fixed payload so the host can prove the plugin really runs.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    execute: async () => ({ ok: true, capability: '${CAPABILITY_ID}', plugin: '${PACKAGE_NAME}' })
  }))
}
`)

  const packed = await packDshPlugin({
    source: PLUGIN_DIR,
    outDir: join(MARKET_DIR, 'artifacts'),
    signingKeyPath: privateKeyPath,
    keyId,
    publisherId
  })

  const index = {
    format: 1,
    generatedAt: new Date().toISOString(),
    dshRuntimeVersion: '0.2.0-rc.2',
    plugins: [{
      name: PACKAGE_NAME,
      title: 'Market self-test',
      version: '0.1.0',
      form: 'dsh-runtime',
      categories: ['selftest'],
      entry: 'dist/main.js',
      tools: [{ name: 'market_selftest_ping', id: CAPABILITY_ID, effect: 'read' }],
      hostDependencies: ['@deepseek-ai/dsh-tools'],
      publisher: publisherId,
      artifact: {
        file: packed.artifact.split('/').pop(),
        sizeBytes: packed.sizeBytes,
        sha256: packed.sha256
      },
      source: relative(resolve('.'), join(OUT, 'plugin')),
      runtimeNote: 'Test instrument for the install chain; not a product.'
    }],
    blocked: []
  }
  const indexPath = join(MARKET_DIR, 'index.json')
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`)
  await copyFile(keyringPath, join(keys, 'dsh-publisher-keys.json'))

  const result = {
    ok: true,
    indexPath,
    keyringPath,
    plugin: PACKAGE_NAME,
    capabilityId: CAPABILITY_ID,
    artifact: packed.artifact,
    sizeBytes: packed.sizeBytes,
    sha256: packed.sha256,
    signature: packed.signature
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})