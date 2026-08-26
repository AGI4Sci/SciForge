#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants as fileConstants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { tsImport } from 'tsx/esm/api'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUEST_CONTRACT_VERSION = 1
const RECEIPT_CONTRACT_VERSION = 1
const RECEIPT_KIND = 'sciforge-local-content-space-authorization-package'
const MAX_REQUEST_BYTES = 1024 * 1024
const PACKAGE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const PROFILE_LOCATION = 'main.content-space-verification-profile'
const PROFILE_CONTRACT_VERSION = '2.0.0'
const GENERATED_FILES = Object.freeze([
  'README.md',
  'package.json',
  'sciforge.domain.json',
  'src/definition.ts',
  'src/main.test.ts',
  'src/main.ts',
  'tsconfig.json'
])

export async function generateLocalContentSpaceAuthorizationPackage(options) {
  const repositoryRoot = resolve(options?.repositoryRoot || REPOSITORY_ROOT)
  await requireRealDirectory(repositoryRoot, 'SciForge repository')
  const requestPath = resolve(requireString(options?.requestPath, 'requestPath'))
  const outputDirectory = resolve(requireString(options?.outputDirectory, 'outputDirectory'))
  const now = options?.now instanceof Date ? options.now : new Date()
  if (!Number.isFinite(now.getTime())) throw new Error('Authorization package time is invalid.')

  await requireCanonicalPrivateRequest(requestPath)
  const requestBytes = await readBoundedRegularFile(
    requestPath,
    MAX_REQUEST_BYTES,
    'Authorization package request'
  )
  const request = parseRequest(requestBytes)
  const policyModule = await loadVerificationPolicyModule(repositoryRoot)
  const profiles = request.profiles.map((profile) =>
    policyModule.contentSpaceVerificationProfileSchema.parse(profile)
  ).sort((left, right) => compareText(left.profileId, right.profileId))
  policyModule.defineContentSpaceVerificationPolicy({
    contractVersion: PROFILE_CONTRACT_VERSION,
    profiles
  })
  for (const profile of profiles) {
    if (Date.parse(profile.expiresAt) <= now.getTime()) {
      throw new Error(`Authorization profile ${profile.profileId} is already expired.`)
    }
  }

  const packageVersions = await readPackageVersions(repositoryRoot)
  const rendered = renderAuthorizationPackage({
    packageId: request.packageId,
    packageVersions,
    profiles,
    sourceRequestSha256: sha256(requestBytes)
  })
  await createNewOutputDirectory(outputDirectory)
  let complete = false
  try {
    for (const [path, source] of Object.entries(rendered.files)) {
      await writePrivatePackageFile(outputDirectory, path, source)
    }
    const inventory = await buildInventory(outputDirectory, GENERATED_FILES)
    const receipt = Object.freeze({
      contractVersion: RECEIPT_CONTRACT_VERSION,
      kind: RECEIPT_KIND,
      packageId: request.packageId,
      packageName: rendered.packageName,
      moduleId: rendered.moduleId,
      sourceRequestSha256: sha256(requestBytes),
      profileCount: profiles.length,
      profiles: Object.freeze(rendered.profileReceipts),
      inventory
    })
    const receiptSource = canonicalPrettyJson(receipt)
    await writePrivatePackageFile(
      outputDirectory,
      'authorization-package-receipt.json',
      receiptSource
    )
    complete = true
    return Object.freeze({
      contractVersion: RECEIPT_CONTRACT_VERSION,
      kind: RECEIPT_KIND,
      outputDirectory,
      packageId: request.packageId,
      packageName: rendered.packageName,
      profileCount: profiles.length,
      receiptSha256: sha256(Buffer.from(receiptSource))
    })
  } finally {
    if (!complete) await rm(outputDirectory, { recursive: true, force: true })
  }
}

function parseRequest(bytes) {
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error('Authorization package request is not valid JSON.', { cause: error })
  }
  requireExactRecord(
    value,
    ['contractVersion', 'packageId', 'profiles'],
    'Authorization package request'
  )
  if (value.contractVersion !== REQUEST_CONTRACT_VERSION ||
    typeof value.packageId !== 'string' || value.packageId.length < 3 ||
    value.packageId.length > 48 || !PACKAGE_ID_PATTERN.test(value.packageId) ||
    !Array.isArray(value.profiles) || value.profiles.length < 1 ||
    value.profiles.length > 256) {
    throw new Error('Authorization package request contract is invalid.')
  }
  return Object.freeze({
    packageId: value.packageId,
    profiles: Object.freeze(value.profiles)
  })
}

function renderAuthorizationPackage({
  packageId,
  packageVersions,
  profiles,
  sourceRequestSha256
}) {
  const packageName = `@sciforge-local/content-space-authorization-${packageId}`
  const moduleId = `sciforge.local-authorization.${packageId}`
  const profileReceipts = []
  const contributionContracts = {}
  const contributionDeclarations = []
  for (const profile of profiles) {
    const contract = Object.freeze({
      location: PROFILE_LOCATION,
      contractVersion: PROFILE_CONTRACT_VERSION,
      profile
    })
    const contractSha256 = sha256(Buffer.from(canonicalJson(contract)))
    const contributionId = `local-authorization.${packageId}.${contractSha256.slice(0, 24)}`
    contributionContracts[contributionId] = contract
    contributionDeclarations.push(Object.freeze({
      id: contributionId,
      kind: 'main.extension',
      version: PROFILE_CONTRACT_VERSION,
      publicRelease: 'forbidden',
      priority: 100
    }))
    profileReceipts.push(Object.freeze({
      contributionId,
      contractSha256,
      profileId: profile.profileId
    }))
  }

  const manifest = Object.freeze({
    contractVersion: 1,
    kind: 'trusted-compile-time',
    composition: 'production',
    packageName,
    publisher: Object.freeze({
      id: 'sciforge-local',
      displayName: 'SciForge Local Authorization'
    }),
    module: Object.freeze({
      id: moduleId,
      displayName: `Local Content Space Authorization (${packageId})`,
      version: '1.0.0',
      hostApi: Object.freeze({ minimum: '1.8.0', maximumExclusive: '2.0.0' }),
      priority: 100
    }),
    contributionContracts: Object.freeze(contributionContracts),
    entrypoints: Object.freeze([Object.freeze({
      process: 'main',
      export: './main',
      contributions: Object.freeze(contributionDeclarations)
    })])
  })
  const packageJson = Object.freeze({
    name: packageName,
    version: '1.0.0',
    private: true,
    license: 'UNLICENSED',
    type: 'module',
    description: 'Generated static Content Space verification profiles; no business runtime.',
    exports: Object.freeze({
      './definition': './src/definition.ts',
      './main': './src/main.ts'
    }),
    files: Object.freeze([
      'src',
      'authorization-package-receipt.json',
      'sciforge.domain.json',
      'package.json',
      'README.md'
    ]),
    scripts: Object.freeze({
      typecheck: 'tsc --noEmit -p tsconfig.json',
      test: 'node --import tsx --test ./src/main.test.ts'
    }),
    dependencies: Object.freeze({
      '@sciforge/domain-content-space': `^${packageVersions.contentSpace}`,
      '@sciforge/domain-sdk': `^${packageVersions.domainSdk}`
    }),
    devDependencies: Object.freeze({
      '@types/node': packageVersions.nodeTypes,
      tsx: packageVersions.tsx,
      typescript: packageVersions.typescript
    })
  })
  const files = Object.freeze({
    'README.md': renderReadme({ packageId, packageName, profiles, sourceRequestSha256 }),
    'package.json': canonicalPrettyJson(packageJson),
    'sciforge.domain.json': canonicalPrettyJson(manifest),
    'src/definition.ts': renderDefinitionSource(),
    'src/main.test.ts': renderMainTestSource(),
    'src/main.ts': renderMainSource(),
    'tsconfig.json': canonicalPrettyJson({
      compilerOptions: {
        target: 'ES2023',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2023'],
        strict: true,
        noImplicitOverride: true,
        noFallthroughCasesInSwitch: true,
        esModuleInterop: true,
        skipLibCheck: true,
        types: ['node'],
        resolveJsonModule: true
      },
      include: ['src/**/*.ts']
    })
  })
  return Object.freeze({
    files,
    moduleId,
    packageName,
    profileReceipts: Object.freeze(profileReceipts)
  })
}

function renderDefinitionSource() {
  return `import {
  defineTrustedDomainPackage,
  type TrustedDomainPackageDefinitionInput
} from '@sciforge/domain-sdk/contract'
import manifest from '../sciforge.domain.json' with { type: 'json' }

export const domainPackageDefinition = defineTrustedDomainPackage(
  manifest as TrustedDomainPackageDefinitionInput
)
`
}

function renderMainSource() {
  return `import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import {
  defineContentSpaceVerificationProfileContribution,
  type ContentSpaceVerificationProfileContribution
} from '@sciforge/domain-content-space/verification-policy'

import { domainPackageDefinition } from './definition.js'

export function createDomainMainEntry(
  _host: DomainMainHost
): TrustedDomainProcessEntryInput<unknown> {
  const entrypoint = domainPackageDefinition.entrypoints.find(
    (candidate) => candidate.process === 'main'
  )
  if (!entrypoint) throw new Error('Generated authorization package has no main entrypoint.')
  return {
    definition: domainPackageDefinition,
    contributions: entrypoint.contributions.map((declaration) => {
      const contract = domainPackageDefinition.contributionContracts[declaration.id]
      if (contract === undefined) {
        throw new Error(\`Generated authorization contract is missing: \${declaration.id}\`)
      }
      return {
        id: declaration.id,
        kind: declaration.kind,
        contract,
        value: defineContentSpaceVerificationProfileContribution(
          contract as ContentSpaceVerificationProfileContribution
        )
      }
    })
  }
}
`
}

function renderMainTestSource() {
  return `import assert from 'node:assert/strict'
import test from 'node:test'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'

import { domainPackageDefinition } from './definition.js'
import { createDomainMainEntry } from './main.js'

test('generated authorization contributions are exact and private', () => {
  const entry = createDomainMainEntry({} as DomainMainHost)
  const declarations = domainPackageDefinition.entrypoints[0]?.contributions ?? []
  assert.equal(entry.contributions.length, declarations.length)
  assert.ok(declarations.length > 0)
  for (const declaration of declarations) {
    assert.equal(declaration.kind, 'main.extension')
    assert.equal(declaration.version, '2.0.0')
    assert.equal(declaration.publicRelease, 'forbidden')
    const contribution = entry.contributions.find((candidate) =>
      candidate.id === declaration.id && candidate.kind === declaration.kind
    )
    assert.ok(contribution)
    assert.deepEqual(contribution.contract, contribution.value)
  }
})
`
}

function renderReadme({ packageId, packageName, profiles, sourceRequestSha256 }) {
  return `# Local Content Space authorization package

This package was generated locally for \`${packageId}\`. It contains only static
\`main.content-space-verification-profile@2.0.0\` contributions and registers no
capability, service, transport, UI, or business behavior.

- Package: \`${packageName}\`
- Profiles: ${profiles.length}
- Source request SHA-256: \`${sourceRequestSha256}\`
- Public release: forbidden for every contribution

Review every Principal, authority/root, operation, audience, transfer limit, validity
window, and external binding before installing this package. Generation does not install
or activate it. Never publish this package or its receipt to a public repository or artifact.
`
}

async function loadVerificationPolicyModule(repositoryRoot) {
  const path = resolve(
    repositoryRoot,
    'packages/domains/content-space/src/verification-policy.ts'
  )
  const module = await tsImport(pathToFileURL(path).href, { parentURL: import.meta.url })
  if (typeof module.defineContentSpaceVerificationPolicy !== 'function' ||
    typeof module.contentSpaceVerificationProfileSchema?.parse !== 'function') {
    throw new Error('Content Space verification policy contract is unavailable.')
  }
  return module
}

async function readPackageVersions(repositoryRoot) {
  const [rootPackage, domainSdk, contentSpace] = await Promise.all([
    readJsonFile(resolve(repositoryRoot, 'package.json')),
    readJsonFile(resolve(repositoryRoot, 'packages/domain-sdk/package.json')),
    readJsonFile(resolve(repositoryRoot, 'packages/domains/content-space/package.json'))
  ])
  const devDependencies = rootPackage.devDependencies
  if (!isRecord(devDependencies) ||
    ![devDependencies.tsx, devDependencies.typescript]
      .every((value) => typeof value === 'string' && Boolean(value)) ||
    typeof domainSdk.version !== 'string' || typeof contentSpace.version !== 'string' ||
    !isRecord(contentSpace.devDependencies) ||
    typeof contentSpace.devDependencies['@types/node'] !== 'string') {
    throw new Error('SciForge package versions required by the generator are unavailable.')
  }
  return Object.freeze({
    contentSpace: contentSpace.version,
    domainSdk: domainSdk.version,
    nodeTypes: contentSpace.devDependencies['@types/node'],
    tsx: devDependencies.tsx,
    typescript: devDependencies.typescript
  })
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function createNewOutputDirectory(path) {
  if (dirname(path) === path) throw new Error('Authorization package output cannot be a root.')
  await requireRealDirectory(dirname(path), 'Authorization package output parent')
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('Authorization package output already exists; it is never overwritten.')
    }
    throw error
  }
}

async function writePrivatePackageFile(root, relativePath, source) {
  const target = resolveContainedPath(root, relativePath)
  const parent = dirname(target)
  if (parent !== root) await mkdir(parent, { recursive: true, mode: 0o700 })
  await writeFile(target, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

async function buildInventory(root, paths) {
  const inventory = []
  for (const path of [...paths].sort()) {
    const bytes = await readBoundedRegularFile(
      resolveContainedPath(root, path),
      MAX_REQUEST_BYTES,
      `Generated authorization package file ${path}`
    )
    inventory.push(Object.freeze({ path, sha256: sha256(bytes), size: bytes.byteLength }))
  }
  return Object.freeze(inventory)
}

async function readBoundedRegularFile(path, maxBytes, label) {
  let handle
  try {
    handle = await open(
      path,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0)
    )
    const entry = await handle.stat()
    if (!entry.isFile() || entry.size < 1 || entry.size > maxBytes) {
      throw new Error(`${label} must be a bounded regular file.`)
    }
    return await handle.readFile()
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new Error(`${label} must be a bounded regular file.`)
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function requireCanonicalPrivateRequest(path) {
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error('Authorization package request must be a canonical bounded regular file.')
  }
  if (process.platform !== 'win32' && (entry.mode & 0o077) !== 0) {
    throw new Error('Authorization package request must be owner-only (mode 0600 or stricter).')
  }
}

async function requireRealDirectory(path, label) {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error(`${label} must be a canonical real directory.`)
  }
}

function resolveContainedPath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath) ||
    relativePath.includes('\\') || relativePath.split('/').some((part) =>
      !part || part === '.' || part === '..'
    )) {
    throw new Error('Authorization package path must be a safe relative POSIX path.')
  }
  const target = resolve(root, ...relativePath.split('/'))
  const relation = relative(root, target)
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error('Authorization package path escapes its output directory.')
  }
  return target
}

function requireExactRecord(value, expectedKeys, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has invalid fields.`)
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Authorization package ${label} is required.`)
  }
  return value.trim()
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Authorization package contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!isRecord(value)) throw new Error('Authorization package contains a non-JSON value.')
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalPrettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sha256(bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (!SHA256_PATTERN.test(digest)) throw new Error('SHA-256 generation failed.')
  return digest
}

function parseCli(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--request', '--output'].includes(flag) || values.has(flag)) {
      throw new Error(`Unknown or duplicate authorization package option: ${flag}`)
    }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`)
    values.set(flag, value)
    index += 1
  }
  if (!values.has('--request') || !values.has('--output')) {
    throw new Error(
      'Usage: node scripts/content-space-local-authorization-package.mjs ' +
      '--request /absolute/request.json --output /absolute/new-package-directory'
    )
  }
  return Object.freeze({
    requestPath: resolve(values.get('--request')),
    outputDirectory: resolve(values.get('--output'))
  })
}

async function main(argv) {
  const result = await generateLocalContentSpaceAuthorizationPackage(parseCli(argv))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[content-space-local-authorization] ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  })
}
