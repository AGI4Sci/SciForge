import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertDomainPackageIdentity,
  auditChangedProductionSources,
  parseArchitecturePrinciplesOptions
} from './architecture-principles-gate.mjs'

test('architecture gate accepts the source-only mode and rejects unknown options', () => {
  assert.deepEqual(parseArchitecturePrinciplesOptions(['--changed-path-only']), {
    mode: 'changed-path-only'
  })
  assert.deepEqual(parseArchitecturePrinciplesOptions([]), { mode: 'full' })
  assert.throws(
    () => parseArchitecturePrinciplesOptions(['--unexpected']),
    /Unknown architecture gate option/u
  )
})

test('changed production audit protects package boundaries', () => {
  assert.deepEqual(auditChangedProductionSources([{
    path: 'packages/domains/example/src/main.ts',
    source: "import type { Secret } from '@shared/private'\n"
  }, {
    path: 'src/main/example.ts',
    source: "import '@sciforge/domain-example/main'\n"
  }, {
    path: 'packages/domains/example/src/main.test.ts',
    source: "import '@shared/private'\n"
  }]), [
    'packages/domains/example/src/main.ts: domain package imports a Host-private source path',
    'src/main/example.ts: Host contains a domain-specific import or identifier'
  ])
})

test('domain package manifests keep package and entrypoint versions aligned', () => {
  assert.doesNotThrow(() => assertDomainPackageIdentity({
    name: '@sciforge/domain-example',
    version: '1.2.3'
  }, {
    packageName: '@sciforge/domain-example',
    module: { version: '1.2.3' },
    entrypoints: [
      { process: 'main', export: './main' },
      { process: 'renderer', export: './renderer' }
    ]
  }, 'packages/domains/example'))
  assert.throws(() => assertDomainPackageIdentity({
    name: '@sciforge/domain-example',
    version: '1.2.3'
  }, {
    packageName: '@sciforge/domain-example',
    module: { version: '1.2.4' },
    entrypoints: [{ process: 'main', export: './main' }]
  }, 'packages/domains/example'), /versions differ/u)
})
