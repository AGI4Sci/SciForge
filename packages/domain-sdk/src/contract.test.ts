import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { z } from 'zod'
import {
  DOMAIN_PACKAGE_CONTRACT_VERSION,
  DOMAIN_PACKAGE_HOST_API_VERSION,
  defineDomainPackage,
  defineTrustedDomainPackage,
  isDomainPackageHostApiCompatible,
  type DomainPackageDefinitionInput,
  type SandboxedDomainPackageDefinitionInput,
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

const sandboxedDefinitionFixture: SandboxedDomainPackageDefinitionInput = {
  contractVersion: DOMAIN_PACKAGE_CONTRACT_VERSION,
  kind: 'sandboxed-runtime',
  packageName: '@sciforge/domain-runtime-probe',
  publisher: {
    id: 'sciforge',
    displayName: 'SciForge'
  },
  module: {
    id: 'sciforge.domain-runtime-probe',
    displayName: 'Runtime Probe',
    version: '1.0.0',
    hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' }
  },
  requestedPermissions: [{
    id: 'host.workspace.read',
    process: 'main',
    reason: 'Read explicitly selected workspace resources.',
    required: true,
    parameters: {
      roots: ['workspace']
    }
  }],
  entrypoints: [
    {
      process: 'main',
      isolation: 'extension-host',
      entry: 'dist/main.js',
      format: 'module',
      contributions: [{
        id: 'runtime-probe.capabilities',
        kind: 'main.capability-factory'
      }]
    },
    {
      process: 'renderer',
      isolation: 'sandboxed-webview',
      entry: 'dist/renderer/index.html',
      format: 'html',
      contributions: [{
        id: 'runtime-probe.panel',
        kind: 'renderer.workbench-right-panel'
      }]
    }
  ]
}

describe('domain package packaging contract', () => {
  it('accepts an explicit contribution-level public release exclusion', () => {
    const definition = defineTrustedDomainPackage({
      ...definitionFixture,
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: [{
          id: 'fixture.domain-runtime.acceptance-profile',
          kind: 'main.extension',
          publicRelease: 'forbidden'
        }]
      }]
    } as unknown as TrustedDomainPackageDefinitionInput)

    assert.equal(
      definition.entrypoints[0]?.contributions[0]?.publicRelease,
      'forbidden'
    )
  })

  it('keeps ordinary contribution policy optional and rejects unknown values', () => {
    const ordinary = defineTrustedDomainPackage({
      ...definitionFixture,
      entrypoints: [{
        process: 'main',
        export: './main',
        contributions: [{
          id: 'fixture.domain-runtime.public-extension',
          kind: 'main.extension'
        }]
      }]
    })
    assert.equal(
      Object.hasOwn(ordinary.entrypoints[0]?.contributions[0] ?? {}, 'publicRelease'),
      false
    )

    assert.throws(
      () => defineTrustedDomainPackage({
        ...definitionFixture,
        entrypoints: [{
          process: 'main',
          export: './main',
          contributions: [{
            id: 'fixture.domain-runtime.invalid-release-policy',
            kind: 'main.extension',
            publicRelease: 'internal-only'
          }]
        }]
      } as unknown as TrustedDomainPackageDefinitionInput),
      z.ZodError
    )
  })

  it('fails closed on unknown trusted-package fields', () => {
    assert.throws(
      () => defineTrustedDomainPackage({
        ...definitionFixture,
        undocumentedFlag: true
      } as unknown as TrustedDomainPackageDefinitionInput),
      z.ZodError
    )
  })

  it('defaults trusted packages to production composition and accepts explicit test fixtures', () => {
    assert.equal(defineTrustedDomainPackage(definitionFixture).composition, 'production')
    assert.equal(defineTrustedDomainPackage({
      ...definitionFixture,
      composition: 'development-only'
    }).composition, 'development-only')
  })

  it('publishes Host API 1.9 while preserving compatible 1.1 package ranges', () => {
    assert.equal(DOMAIN_PACKAGE_HOST_API_VERSION, '1.9.0')
    assert.equal(isDomainPackageHostApiCompatible({
      minimum: '1.1.0',
      maximumExclusive: '2.0.0'
    }, '1.1.0'), true)
    assert.equal(isDomainPackageHostApiCompatible({
      minimum: '1.1.0',
      maximumExclusive: '2.0.0'
    }, '1.0.0'), false)
  })

  it('allows only trusted packages to declare a conventional workspace-server entrypoint', () => {
    const trusted = defineTrustedDomainPackage({
      ...definitionFixture,
      entrypoints: [
        ...definitionFixture.entrypoints,
        {
          process: 'workspace-server',
          export: './workspace-server',
          contributions: [{
            id: 'fixture.domain-runtime.remote-provider',
            kind: 'workspace-server.fixture-provider'
          }]
        }
      ]
    })

    assert.equal(trusted.entrypoints[1]?.process, 'workspace-server')
    assert.throws(
      () => defineDomainPackage({
        ...sandboxedDefinitionFixture,
        entrypoints: [
          ...sandboxedDefinitionFixture.entrypoints,
          {
            process: 'workspace-server',
            isolation: 'extension-host',
            entry: 'dist/workspace-server.js',
            format: 'module',
            contributions: []
          }
        ]
      } as unknown as DomainPackageDefinitionInput),
      z.ZodError
    )
  })

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

describe('sandboxed runtime domain package contract', () => {
  it('keeps existing trusted manifests valid through the single package schema', () => {
    const definition = defineDomainPackage(definitionFixture)

    assert.equal(definition.kind, 'trusted-compile-time')
    assert.equal(definition.packageName, definitionFixture.packageName)
    assert.equal(Object.hasOwn(definition, 'publisher'), false)
  })

  it('normalizes and freezes publisher, permissions, compatibility, and isolated entrypoints', () => {
    const definition = defineDomainPackage(sandboxedDefinitionFixture)

    assert.equal(definition.kind, 'sandboxed-runtime')
    if (definition.kind !== 'sandboxed-runtime') return
    assert.deepEqual(definition.publisher, {
      id: 'sciforge',
      displayName: 'SciForge'
    })
    assert.equal(definition.entrypoints[0]?.process, 'main')
    assert.equal(definition.entrypoints[0]?.isolation, 'extension-host')
    assert.equal(definition.entrypoints[1]?.process, 'renderer')
    assert.equal(definition.entrypoints[1]?.isolation, 'sandboxed-webview')
    assert.equal(definition.requestedPermissions[0]?.process, 'main')
    assert.equal(
      isDomainPackageHostApiCompatible(definition.module.hostApi, '1.4.0'),
      true
    )
    assert.equal(
      isDomainPackageHostApiCompatible(definition.module.hostApi, '2.0.0'),
      false
    )
    assert.equal(Object.isFrozen(definition), true)
    assert.equal(Object.isFrozen(definition.publisher), true)
    assert.equal(Object.isFrozen(definition.requestedPermissions), true)
    assert.equal(Object.isFrozen(definition.requestedPermissions[0]?.parameters), true)
    assert.equal(Object.isFrozen(definition.entrypoints), true)
  })

  it('does not allow a manifest to self-assert signature or publisher verification', () => {
    for (const input of [
      {
        ...sandboxedDefinitionFixture,
        signature: {
          algorithm: 'ed25519',
          verified: true
        }
      },
      {
        ...sandboxedDefinitionFixture,
        trust: {
          publisherVerified: true
        }
      },
      {
        ...sandboxedDefinitionFixture,
        publisher: {
          ...sandboxedDefinitionFixture.publisher,
          verified: true
        }
      }
    ]) {
      assert.throws(
        () => defineDomainPackage(input as unknown as DomainPackageDefinitionInput),
        z.ZodError
      )
    }
  })

  it('fails closed on unknown fields, package kinds, and unsafe entrypoint shapes', () => {
    for (const input of [
      {
        ...sandboxedDefinitionFixture,
        undocumentedFlag: true
      },
      {
        ...sandboxedDefinitionFixture,
        kind: 'trusted-runtime'
      },
      {
        ...sandboxedDefinitionFixture,
        entrypoints: [{
          process: 'main',
          isolation: 'electron-main',
          entry: 'dist/main.js',
          format: 'module',
          contributions: []
        }]
      },
      {
        ...sandboxedDefinitionFixture,
        entrypoints: [{
          process: 'renderer',
          isolation: 'host-renderer',
          entry: 'dist/renderer.js',
          format: 'module',
          contributions: []
        }]
      },
      {
        ...sandboxedDefinitionFixture,
        entrypoints: [{
          process: 'main',
          isolation: 'extension-host',
          entry: '../outside.js',
          format: 'module',
          contributions: []
        }]
      },
      {
        ...sandboxedDefinitionFixture,
        entrypoints: [{
          process: 'main',
          isolation: 'extension-host',
          export: './main',
          format: 'module',
          contributions: []
        }]
      }
    ]) {
      assert.throws(
        () => defineDomainPackage(input as unknown as DomainPackageDefinitionInput),
        z.ZodError
      )
    }
  })

  it('rejects missing, duplicate, or process-orphaned permission requests', () => {
    const mainOnly = {
      ...sandboxedDefinitionFixture,
      entrypoints: [sandboxedDefinitionFixture.entrypoints[0]!]
    }
    for (const input of [
      {
        ...sandboxedDefinitionFixture,
        requestedPermissions: undefined
      },
      {
        ...mainOnly,
        requestedPermissions: [{
          id: 'host.clipboard.write',
          process: 'renderer',
          reason: 'Copy an explicit user export.',
          required: false
        }]
      },
      {
        ...sandboxedDefinitionFixture,
        requestedPermissions: [
          sandboxedDefinitionFixture.requestedPermissions[0]!,
          sandboxedDefinitionFixture.requestedPermissions[0]!
        ]
      },
      {
        ...sandboxedDefinitionFixture,
        requestedPermissions: [{
          id: 'filesystem',
          process: 'main',
          reason: 'Too broad and not namespaced.',
          required: true
        }]
      },
      {
        ...sandboxedDefinitionFixture,
        requestedPermissions: [{
          ...sandboxedDefinitionFixture.requestedPermissions[0]!,
          granted: true
        }]
      }
    ]) {
      assert.throws(
        () => defineDomainPackage(input as unknown as DomainPackageDefinitionInput),
        z.ZodError
      )
    }
  })

  it('rejects duplicate process entrypoints and invalid host API ranges', () => {
    for (const input of [
      {
        ...sandboxedDefinitionFixture,
        entrypoints: [
          sandboxedDefinitionFixture.entrypoints[0]!,
          sandboxedDefinitionFixture.entrypoints[0]!
        ]
      },
      {
        ...sandboxedDefinitionFixture,
        module: {
          ...sandboxedDefinitionFixture.module,
          hostApi: {
            minimum: '2.0.0',
            maximumExclusive: '2.0.0'
          }
        }
      },
      {
        ...sandboxedDefinitionFixture,
        module: {
          ...sandboxedDefinitionFixture.module,
          hostApi: {
            minimum: '1.0',
            maximumExclusive: '2.0.0'
          }
        }
      }
    ]) {
      assert.throws(
        () => defineDomainPackage(input as unknown as DomainPackageDefinitionInput),
        z.ZodError
      )
    }
  })
})
