import { execFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { SignedExtensionStore } from './store'

const execFileAsync = promisify(execFile)
const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ))
})

describe('official extension package and install store', () => {
  it('installs the exact deterministic artifact emitted by the repository packer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-package-store-'))
    temporaryPaths.push(root)
    const sourcePath = join(root, 'source')
    const archivePath = join(root, 'runtime.sciforge-plugin')
    const privateKeyPath = join(root, 'official-private.pem')
    await mkdir(join(sourcePath, 'dist'), { recursive: true })

    await writeFile(join(sourcePath, 'package.json'), JSON.stringify({
      name: '@sciforge/domain-package-store-test',
      version: '1.0.0',
      type: 'module',
      files: ['dist/**']
    }))
    await writeFile(join(sourcePath, 'sciforge.domain.json'), JSON.stringify({
      contractVersion: 1,
      kind: 'sandboxed-runtime',
      packageName: '@sciforge/domain-package-store-test',
      publisher: { id: 'sciforge', displayName: 'SciForge' },
      module: {
        id: 'sciforge.package-store-test',
        displayName: 'Package Store Test',
        version: '1.0.0',
        hostApi: { minimum: '1.0.0', maximumExclusive: '2.0.0' },
        priority: 100
      },
      requestedPermissions: [],
      contributionContracts: {},
      entrypoints: [{
        process: 'main',
        isolation: 'extension-host',
        entry: 'dist/main.js',
        format: 'module',
        contributions: []
      }]
    }))
    await writeFile(join(sourcePath, 'dist/main.js'), 'export async function activate() {}\n')

    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
    await execFileAsync(process.execPath, [
      fileURLToPath(new URL('../../../scripts/extension-package.mjs', import.meta.url)),
      'pack',
      '--source',
      sourcePath,
      '--output',
      archivePath,
      '--publisher-id',
      'sciforge',
      '--key-id',
      'official-integration-test',
      '--private-key-file',
      privateKeyPath
    ])

    const store = new SignedExtensionStore({
      userDataPath: join(root, 'user-data'),
      hostApiVersion: '1.0.0',
      trustedKeys: [{
        keyId: 'official-integration-test',
        publisherId: 'sciforge',
        publicKey
      }]
    })
    const installed = await store.install(archivePath)

    expect(installed).toMatchObject({
      health: 'ready',
      package: {
        packageName: '@sciforge/domain-package-store-test',
        moduleId: 'sciforge.package-store-test',
        activeVersion: '1.0.0'
      },
      active: {
        signer: {
          trust: 'official',
          keyId: 'official-integration-test'
        },
        runtime: {
          kind: 'sandboxed-runtime'
        }
      }
    })
  })
})
