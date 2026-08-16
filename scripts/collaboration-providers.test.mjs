import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  discoverCollaborationProviders,
  renderInstalledCollaborationProviders
} from './collaboration-providers.mjs'

test('discovers providers by manifest and renders provider-neutral static composition', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-provider-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createProvider(root, 'zeta', '@fixture/provider-zeta', 'zeta')
  await createProvider(root, 'alpha', '@fixture/provider-alpha', 'alpha')

  const providers = await discoverCollaborationProviders(root)
  assert.deepEqual(providers.map(({ manifest }) => manifest.provider), ['alpha', 'zeta'])
  const generated = renderInstalledCollaborationProviders(providers)
  assert.match(generated, /@fixture\/provider-alpha\/server/u)
  assert.match(generated, /@fixture\/provider-zeta\/server/u)
  assert.match(generated, /createInstalledHumanEndpointProviders/u)
  assert.match(generated, /contextFor\(entry\.definition\)/u)
  assert.doesNotMatch(generated, /switch\s*\(|if\s*\([^)]*===\s*['"](?:alpha|zeta)/u)
})

test('fails closed on duplicate provider identity and unknown manifest fields', async (context) => {
  const duplicateRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-provider-generator-'))
  const extraRoot = await mkdtemp(path.join(os.tmpdir(), 'sciforge-provider-generator-'))
  context.after(() => Promise.all([
    rm(duplicateRoot, { recursive: true, force: true }),
    rm(extraRoot, { recursive: true, force: true })
  ]))
  await createProvider(duplicateRoot, 'one', '@fixture/provider-one', 'shared')
  await createProvider(duplicateRoot, 'two', '@fixture/provider-two', 'shared')
  await createProvider(extraRoot, 'extra', '@fixture/provider-extra', 'extra', {
    centralProviderMap: true
  })

  await assert.rejects(discoverCollaborationProviders(duplicateRoot), /Duplicate.*provider ID/u)
  await assert.rejects(discoverCollaborationProviders(extraRoot), /invalid fields/u)
})

test('requires the conventional server export and factory without a root entrypoint', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-provider-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createProvider(root, 'broken', '@fixture/provider-broken', 'broken', {}, {
    exports: {
      '.': './src/server.ts',
      './server': serverExport()
    },
    source: 'export const differentFactory = () => ({})\n'
  })
  await assert.rejects(
    discoverCollaborationProviders(root),
    /must not expose a process-ambiguous root export/u
  )
})

test('requires source/types/import conditions and validates the source condition', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sciforge-provider-generator-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await createProvider(root, 'legacy', '@fixture/provider-legacy', 'legacy', {}, {
    exports: { './server': './src/server.ts' }
  })

  await assert.rejects(discoverCollaborationProviders(root), /\.\/server export must be an object/u)
})

async function createProvider(
  root,
  directory,
  packageName,
  provider,
  extraManifest = {},
  overrides = {}
) {
  const packageRoot = path.join(root, 'packages', `collaboration-provider-${directory}`)
  await mkdir(path.join(packageRoot, 'src'), { recursive: true })
  await writeFile(path.join(packageRoot, 'sciforge.provider.json'), JSON.stringify({
    contractVersion: 1,
    kind: 'human-endpoint-provider',
    packageName,
    provider,
    module: {
      id: `fixture.provider-${directory}`,
      displayName: `${directory} provider`,
      version: '1.0.0',
      providerApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' }
    },
    entrypoint: { process: 'collaboration-server', export: './server' },
    ...extraManifest
  }))
  await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    type: 'module',
    exports: overrides.exports ?? { './server': serverExport() },
    scripts: { test: 'node --test', typecheck: 'tsc --noEmit' }
  }))
  await writeFile(
    path.join(packageRoot, 'src/server.ts'),
    overrides.source ?? 'export const createHumanEndpointProvider = () => ({})\n'
  )
}

function serverExport() {
  return {
    source: './src/server.ts',
    types: './dist/server.d.ts',
    import: './dist/server.js'
  }
}
