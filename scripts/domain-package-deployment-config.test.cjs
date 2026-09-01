const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')

const {
  createDomainPackageDeploymentConfigurationComposition,
  verifyPackagedDomainDeploymentConfigurations
} = require('./domain-package-deployment-config.cjs')

const SOURCE_PATH = '.sciforge/private/deployments/fixture.json'
const PACKAGED_PATH = 'domain-deployments/fixture.json'
const sidecar = Object.freeze({
  contractVersion: 1,
  providerInstanceRef: 'fixture-instance',
  origin: 'https://tenant.example'
})

test('composition preserves a declaration without activating a missing source sidecar', () => {
  const root = tempRoot()
  try {
    writeDomainPackage(root, 'fixture-a', '@fixture/domain-a', deploymentMetadata())

    assert.deepEqual(createDomainPackageDeploymentConfigurationComposition(root), {
      extraResources: [],
      deploymentConfigurationDeclarations: [declaration('@fixture/domain-a')],
      activeDeploymentConfigurationReceipts: []
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('composition copies only a declared, contained, regular sidecar with a fixed digest', () => {
  const root = tempRoot()
  try {
    writeDomainPackage(root, 'fixture-a', '@fixture/domain-a', deploymentMetadata())
    const content = `${JSON.stringify(sidecar)}\n`
    write(join(root, SOURCE_PATH), content)

    assert.deepEqual(createDomainPackageDeploymentConfigurationComposition(root), {
      extraResources: [{ from: SOURCE_PATH, to: PACKAGED_PATH }],
      deploymentConfigurationDeclarations: [declaration('@fixture/domain-a')],
      activeDeploymentConfigurationReceipts: [{
        packageName: '@fixture/domain-a',
        sourceRelativePath: SOURCE_PATH,
        packagedResourcesRelativePath: PACKAGED_PATH,
        maxBytes: 4096,
        publicRelease: 'forbidden',
        size: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex')
      }]
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('generic composition preserves an explicitly public deployment policy', () => {
  const root = tempRoot()
  try {
    writeDomainPackage(root, 'fixture-a', '@fixture/domain-a', {
      ...deploymentMetadata(),
      publicRelease: 'allowed'
    })
    write(join(root, SOURCE_PATH), JSON.stringify(sidecar))

    const composition = createDomainPackageDeploymentConfigurationComposition(root)
    assert.equal(
      composition.activeDeploymentConfigurationReceipts[0].publicRelease,
      'allowed'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('composition rejects escaping metadata, duplicate targets, and source symlinks', () => {
  const escapingRoot = tempRoot()
  try {
    writeDomainPackage(escapingRoot, 'fixture-a', '@fixture/domain-a', {
      ...deploymentMetadata(),
      sourceRelativePath: '../outside.json'
    })
    assert.throws(
      () => createDomainPackageDeploymentConfigurationComposition(escapingRoot),
      /sourceRelativePath/u
    )
  } finally {
    rmSync(escapingRoot, { recursive: true, force: true })
  }

  const duplicateRoot = tempRoot()
  try {
    writeDomainPackage(duplicateRoot, 'fixture-a', '@fixture/domain-a', deploymentMetadata())
    writeDomainPackage(duplicateRoot, 'fixture-b', '@fixture/domain-b', {
      ...deploymentMetadata(),
      sourceRelativePath: '.sciforge/private/deployments/fixture-b.json'
    })
    write(join(duplicateRoot, SOURCE_PATH), JSON.stringify(sidecar))
    write(
      join(duplicateRoot, '.sciforge/private/deployments/fixture-b.json'),
      JSON.stringify(sidecar)
    )
    assert.throws(
      () => createDomainPackageDeploymentConfigurationComposition(duplicateRoot),
      /Duplicate deployment configuration target/u
    )
  } finally {
    rmSync(duplicateRoot, { recursive: true, force: true })
  }

  const symlinkRoot = tempRoot()
  try {
    writeDomainPackage(symlinkRoot, 'fixture-a', '@fixture/domain-a', deploymentMetadata())
    const realSidecar = join(symlinkRoot, '.sciforge/private/deployments/real.json')
    write(realSidecar, JSON.stringify(sidecar))
    symlinkSync(realSidecar, join(symlinkRoot, SOURCE_PATH), 'file')
    assert.throws(
      () => createDomainPackageDeploymentConfigurationComposition(symlinkRoot),
      /symbolic link/u
    )
  } finally {
    rmSync(symlinkRoot, { recursive: true, force: true })
  }
})

test('after-pack verification rejects missing, changed, oversized, and symlinked targets', () => {
  for (const corruption of ['none', 'missing', 'changed', 'oversized', 'symlink']) {
    const root = tempRoot()
    const resourcesRoot = join(root, 'resources')
    try {
      mkdirSync(resourcesRoot, { recursive: true })
      writeDomainPackage(root, 'fixture-a', '@fixture/domain-a', deploymentMetadata())
      write(join(root, SOURCE_PATH), `${JSON.stringify(sidecar)}\n`)
      const composition = createDomainPackageDeploymentConfigurationComposition(root)
      const target = join(resourcesRoot, PACKAGED_PATH)
      if (corruption !== 'missing') {
        mkdirSync(dirname(target), { recursive: true })
        cpSync(join(root, SOURCE_PATH), target, { recursive: false })
      }
      if (corruption === 'changed') write(target, `${JSON.stringify({ ...sidecar, drift: true })}\n`)
      if (corruption === 'oversized') write(target, 'x'.repeat(4097))
      if (corruption === 'symlink') {
        rmSync(target)
        const realTarget = join(resourcesRoot, 'real.json')
        write(realTarget, JSON.stringify(sidecar))
        symlinkSync(realTarget, target, 'file')
      }

      const verify = () => verifyPackagedDomainDeploymentConfigurations(
        resourcesRoot,
        composition
      )
      if (corruption === 'none') assert.doesNotThrow(verify)
      else assert.throws(verify, /missing|changed|maximum|symbolic link/u)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('captured active receipt remains authoritative after its source sidecar is removed', () => {
  const root = tempRoot()
  const resourcesRoot = join(root, 'resources')
  try {
    mkdirSync(resourcesRoot, { recursive: true })
    writeDomainPackage(root, 'fixture-a', '@fixture/domain-a', deploymentMetadata())
    write(join(root, SOURCE_PATH), `${JSON.stringify(sidecar)}\n`)
    const composition = createDomainPackageDeploymentConfigurationComposition(root)
    rmSync(join(root, SOURCE_PATH))

    assert.throws(
      () => verifyPackagedDomainDeploymentConfigurations(resourcesRoot, composition),
      /missing/u
    )
    write(join(resourcesRoot, PACKAGED_PATH), JSON.stringify({ ...sidecar, drift: true }))
    assert.throws(
      () => verifyPackagedDomainDeploymentConfigurations(resourcesRoot, composition),
      /changed/u
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('inactive declaration requires its packaged target to remain absent', () => {
  const root = tempRoot()
  const resourcesRoot = join(root, 'resources')
  try {
    mkdirSync(resourcesRoot, { recursive: true })
    writeDomainPackage(root, 'fixture-a', '@fixture/domain-a', deploymentMetadata())
    const composition = createDomainPackageDeploymentConfigurationComposition(root)

    assert.doesNotThrow(
      () => verifyPackagedDomainDeploymentConfigurations(resourcesRoot, composition)
    )
    write(join(resourcesRoot, PACKAGED_PATH), JSON.stringify(sidecar))
    assert.throws(
      () => verifyPackagedDomainDeploymentConfigurations(resourcesRoot, composition),
      /must be absent/u
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the OpenContent package declares one public package-owned deployment configuration', () => {
  const packageJson = require('../packages/domains/opencontent-connector/package.json')
  assert.deepEqual(packageJson.sciforgeDeploymentConfiguration, {
    contractVersion: 1,
    sourceRelativePath: 'packages/domains/opencontent-connector/config/opencontent-connector.json',
    packagedResourcesRelativePath: 'domain-deployments/opencontent-connector.json',
    maxBytes: 4096,
    publicRelease: 'allowed'
  })
  assert.ok(packageJson.files.includes('config'))
  const configuration = require(
    '../packages/domains/opencontent-connector/config/opencontent-connector.json'
  )
  assert.deepEqual(configuration, {
    contractVersion: 1,
    providerInstanceRef: 'opencontent-edoc2-demo',
    origin: 'https://test1.edoc2.com'
  })
})

function deploymentMetadata() {
  return {
    contractVersion: 1,
    sourceRelativePath: SOURCE_PATH,
    packagedResourcesRelativePath: PACKAGED_PATH,
    maxBytes: 4096,
    publicRelease: 'forbidden'
  }
}

function declaration(packageName) {
  return {
    packageName,
    contractVersion: 1,
    sourceRelativePath: SOURCE_PATH,
    packagedResourcesRelativePath: PACKAGED_PATH,
    maxBytes: 4096,
    publicRelease: 'forbidden'
  }
}

function writeDomainPackage(root, directory, packageName, deploymentConfiguration) {
  const packageRoot = join(root, 'packages', 'domains', directory)
  write(join(packageRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    ...(deploymentConfiguration === undefined
      ? {}
      : { sciforgeDeploymentConfiguration: deploymentConfiguration })
  }))
  write(join(packageRoot, 'sciforge.domain.json'), JSON.stringify({ packageName }))
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), 'sciforge-deployment-composition-'))
}
