import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinitionInput
} from './contract.js'

const definitionFixture: TrustedDomainPackageDefinitionInput = {
  contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
  kind: 'trusted-compile-time',
  packageName: '@fixture/domain-runtime',
  module: {
    id: 'fixture.domain-runtime',
    displayName: 'Fixture Domain Runtime',
    version: '1.0.0',
    hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' }
  },
  entrypoints: [{
    process: 'main',
    export: './main',
    contributions: []
  }]
}

describe('domain package packaging contract', () => {
  it('normalizes and freezes package-owned runtime metadata', () => {
    const definition = defineTrustedDomainPackage({
      ...definitionFixture,
      packaging: {
        bundled: true,
        runtime: {
          requiredPaths: ['python/domain_runtime/server.py', 'ui/index.html'],
          dependencies: ['@fixture/domain-foundation']
        }
      }
    })

    assert.deepEqual(definition.packaging, {
      bundled: true,
      runtime: {
        requiredPaths: ['python/domain_runtime/server.py', 'ui/index.html'],
        dependencies: ['@fixture/domain-foundation']
      }
    })
    assert.equal(Object.isFrozen(definition.packaging), true)
    assert.equal(Object.isFrozen(definition.packaging?.runtime), true)
    assert.equal(Object.isFrozen(definition.packaging?.runtime?.requiredPaths), true)
  })

  it('rejects paths outside the package and duplicate runtime metadata', () => {
    for (const requiredPath of [
      '/etc/passwd',
      'C:/Windows/System32',
      '../outside',
      'python/../outside',
      'python\\outside'
    ]) {
      assert.throws(
        () => defineTrustedDomainPackage({
          ...definitionFixture,
          packaging: {
            bundled: true,
            runtime: { requiredPaths: [requiredPath] }
          }
        }),
        z.ZodError
      )
    }

    assert.throws(
      () => defineTrustedDomainPackage({
        ...definitionFixture,
        packaging: {
          bundled: true,
          runtime: {
            requiredPaths: ['ui/index.html', 'ui/index.html'],
            dependencies: ['@fixture/domain-foundation', '@fixture/domain-foundation']
          }
        }
      }),
      z.ZodError
    )
    for (const implicitPath of ['package.json', 'sciforge.domain.json']) {
      assert.throws(
        () => defineTrustedDomainPackage({
          ...definitionFixture,
          packaging: {
            bundled: true,
            runtime: { requiredPaths: [implicitPath] }
          }
        }),
        z.ZodError
      )
    }
  })

  it('rejects self dependencies and runtime requirements on non-bundled packages', () => {
    assert.throws(
      () => defineTrustedDomainPackage({
        ...definitionFixture,
        packaging: {
          bundled: true,
          runtime: { dependencies: [definitionFixture.packageName] }
        }
      }),
      z.ZodError
    )
    assert.throws(
      () => defineTrustedDomainPackage({
        ...definitionFixture,
        packaging: {
          bundled: false,
          runtime: { requiredPaths: ['python/domain_runtime/server.py'] }
        }
      }),
      z.ZodError
    )
  })
})
