import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type BigIntStats
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR,
  resolveOpenContentDeploymentConfiguration as resolveInstalledDeploymentConfiguration
} from './deployment-config.js'

const sidecar = Object.freeze({
  contractVersion: 1 as const,
  providerInstanceRef: 'opencontent-edoc2-demo' as const,
  origin: 'https://tenant.example'
})

function resolveOpenContentDeploymentConfiguration(
  host: Parameters<typeof resolveInstalledDeploymentConfiguration>[0],
  fileOperations?: Parameters<typeof resolveInstalledDeploymentConfiguration>[2]
) {
  return resolveInstalledDeploymentConfiguration(
    host,
    sidecar.providerInstanceRef,
    fileOperations
  )
}

const tempRoots: string[] = []

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('OpenContent package-owned deployment configuration', () => {
  it('ships one public package-owned endpoint and no alternate environment channel', () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const production = [
      readFileSync(join(packageRoot, 'README.md'), 'utf8'),
      ...readProductionSources(join(packageRoot, 'src'))
    ].join('\n')
    const configured = JSON.parse(readFileSync(
      resolve(
        packageRoot,
        '../../..',
        OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath
      ),
      'utf8'
    ))

    expect(OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR).toMatchObject({
      sourceRelativePath:
        'packages/domains/opencontent-connector/config/opencontent-connector.json',
      publicRelease: 'allowed'
    })
    expect(configured).toEqual({
      contractVersion: 1,
      providerInstanceRef: 'opencontent-edoc2-demo',
      origin: 'https://test1.edoc2.com'
    })
    expect(production).not.toMatch(/SCIFORGE_OPENCONTENT(?:_BASE_URL)?/u)
  })

  it('resolves only the fixed source sidecar from an absolute synthetic repository root', () => {
    const root = tempRoot()
    writeJson(join(root, OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath), sidecar)

    const resolved = resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    })

    expect(resolved).toEqual(sidecar)
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('resolves only the fixed packaged sidecar beside the synthetic app archive', () => {
    const resourcesRoot = tempRoot()
    const appRoot = join(resourcesRoot, 'app.asar')
    writeFileSync(appRoot, 'fixture archive', 'utf8')
    writeJson(
      join(
        resourcesRoot,
        OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.packagedResourcesRelativePath
      ),
      sidecar
    )

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => appRoot,
      isPackaged: () => true
    })).toEqual(sidecar)
  })

  it('does not fall back between source and packaged locations', () => {
    const sourceRoot = tempRoot()
    writeJson(
      join(
        sourceRoot,
        OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.packagedResourcesRelativePath
      ),
      sidecar
    )
    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => sourceRoot,
      isPackaged: () => false
    })).toBeUndefined()

    const resourcesRoot = tempRoot()
    const appRoot = join(resourcesRoot, 'app.asar')
    writeFileSync(appRoot, 'fixture archive', 'utf8')
    writeJson(
      join(
        resourcesRoot,
        OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath
      ),
      sidecar
    )
    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => appRoot,
      isPackaged: () => true
    })).toBeUndefined()
  })

  it.each([
    ['missing', undefined],
    ['malformed JSON', '{'],
    ['HTTP origin', { ...sidecar, origin: 'http://tenant.example' }],
    ['userinfo origin', { ...sidecar, origin: 'https://user@tenant.example' }],
    ['path origin', { ...sidecar, origin: 'https://tenant.example/api' }],
    ['query origin', { ...sidecar, origin: 'https://tenant.example?tenant=1' }],
    ['fragment origin', { ...sidecar, origin: 'https://tenant.example#tenant' }],
    ['whitespace-padded origin', { ...sidecar, origin: ' https://tenant.example ' }],
    ['unknown field', { ...sidecar, endpoint: 'https://tenant.example' }]
  ] as const)('treats %s as unavailable', (_label, value) => {
    const root = tempRoot()
    if (value !== undefined) {
      writeRaw(
        join(root, OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath),
        typeof value === 'string' ? value : JSON.stringify(value)
      )
    }

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    })).toBeUndefined()
  })

  it('treats an oversized sidecar as unavailable without parsing a prefix', () => {
    const root = tempRoot()
    writeRaw(
      join(root, OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath),
      ' '.repeat(OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.maxBytes + 1)
    )

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    })).toBeUndefined()
  })

  it('rejects a sidecar symlink even when its target is a valid contained file', () => {
    const root = tempRoot()
    const configuredSidecar = join(
      root,
      OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath
    )
    const realSidecar = join(dirname(configuredSidecar), 'real.json')
    writeJson(realSidecar, sidecar)
    symlinkSync(realSidecar, configuredSidecar, 'file')

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    })).toBeUndefined()
  })

  it('rejects relative or non-directory roots and symlinked path ancestors', () => {
    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => 'relative/repository',
      isPackaged: () => false
    })).toBeUndefined()

    const root = tempRoot()
    const realPackagesRoot = join(root, 'real-packages')
    mkdirSync(realPackagesRoot, { recursive: true })
    symlinkSync(realPackagesRoot, join(root, 'packages'), 'dir')
    writeJson(
      join(realPackagesRoot, 'domains', 'opencontent-connector', 'config',
        'opencontent-connector.json'),
      sidecar
    )

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    })).toBeUndefined()
  })

  it('opens with no-follow, reads the original fd, and rejects a replaced pathname', () => {
    const root = tempRoot()
    const configuredPath = join(
      root,
      OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath
    )
    const openedPath = join(dirname(configuredPath), 'opened.json')
    writeJson(configuredPath, sidecar)
    let observedFlags: number | undefined
    let observedContents: string | undefined
    let replaced = false
    const operations = fileOperations({
      open(path, flags) {
        observedFlags = flags
        return openSync(path, flags)
      },
      read(fd, buffer, offset, length, position) {
        if (!replaced) {
          replaced = true
          renameSync(configuredPath, openedPath)
          writeJson(configuredPath, { ...sidecar, origin: 'https://replacement.example' })
        }
        const count = readSync(fd, buffer, offset, length, position)
        if (count > 0) {
          observedContents = buffer.toString('utf8', 0, offset + count)
        }
        return count
      }
    })

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    }, operations)).toBeUndefined()
    expect(replaced).toBe(true)
    expect(JSON.parse(observedContents!)).toEqual(sidecar)
    if (typeof constants.O_NOFOLLOW === 'number') {
      expect((observedFlags! & constants.O_NOFOLLOW) === constants.O_NOFOLLOW).toBe(true)
    }
  })

  it('binds the opened fd to the pre-open file identity when no-follow is unavailable', () => {
    const root = tempRoot()
    const configuredPath = join(
      root,
      OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath
    )
    const originalPath = join(dirname(configuredPath), 'original.json')
    writeJson(configuredPath, sidecar)
    let replacedBeforeOpen = false
    const operations = fileOperations({
      open(path) {
        renameSync(path, originalPath)
        writeJson(path, { ...sidecar, origin: 'https://replacement.example' })
        replacedBeforeOpen = true
        return openSync(path, constants.O_RDONLY)
      }
    })

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    }, operations)).toBeUndefined()
    expect(replacedBeforeOpen).toBe(true)
  })

  it('bounds the same-fd read and rejects growth after the first fstat', () => {
    const root = tempRoot()
    const configuredPath = join(
      root,
      OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath
    )
    writeJson(configuredPath, sidecar)
    let maximumRequestedRead = 0
    let grew = false
    const operations = fileOperations({
      read(fd, buffer, offset, length, position) {
        maximumRequestedRead = Math.max(maximumRequestedRead, length)
        if (!grew) {
          grew = true
          writeRaw(
            configuredPath,
            'x'.repeat(OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.maxBytes + 128)
          )
        }
        return readSync(fd, buffer, offset, length, position)
      }
    })

    expect(resolveOpenContentDeploymentConfiguration({
      getAppRoot: () => root,
      isPackaged: () => false
    }, operations)).toBeUndefined()
    expect(grew).toBe(true)
    expect(maximumRequestedRead).toBeLessThanOrEqual(
      OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.maxBytes + 1
    )
  })
})

type FileOperations = Readonly<{
  open(path: string, flags: number): number
  fstat(fd: number): BigIntStats
  read(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: null
  ): number
  close(fd: number): void
}>

function fileOperations(overrides: Partial<FileOperations>): FileOperations {
  return Object.freeze({
    open: (path: string, flags: number) => openSync(path, flags),
    fstat: (fd: number) => fstatSync(fd, { bigint: true }),
    read: (
      fd: number,
      buffer: Buffer,
      offset: number,
      length: number,
      position: null
    ) => readSync(fd, buffer, offset, length, position),
    close: (fd: number) => closeSync(fd),
    ...overrides
  }) as FileOperations
}

function readProductionSources(root: string): string[] {
  const sources: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      sources.push(...readProductionSources(path))
    } else if (entry.isFile() && entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts')) {
      sources.push(readFileSync(path, 'utf8'))
    }
  }
  return sources
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sciforge-opencontent-deployment-'))
  tempRoots.push(root)
  return root
}

function writeRaw(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value, 'utf8')
}

function writeJson(path: string, value: unknown): void {
  writeRaw(path, `${JSON.stringify(value)}\n`)
}
