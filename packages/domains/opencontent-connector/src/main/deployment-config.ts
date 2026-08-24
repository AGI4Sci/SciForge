import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type BigIntStats
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { z } from 'zod'

import packageManifest from '../../package.json' with { type: 'json' }

import { OPENCONTENT_PROVIDER_INSTANCE_REF } from '../contract.js'

const deploymentConfigurationDescriptorSchema = z.object({
  contractVersion: z.literal(1),
  sourceRelativePath: packageRelativePathSchema(),
  packagedResourcesRelativePath: packageRelativePathSchema(),
  maxBytes: z.number().int().min(1).max(64 * 1024),
  publicRelease: z.literal('forbidden')
}).strict().readonly()

const openContentDeploymentConfigurationSchema = z.object({
  contractVersion: z.literal(1),
  providerInstanceRef: z.literal(OPENCONTENT_PROVIDER_INSTANCE_REF),
  origin: z.string().min(1).max(2048).refine(isAbsoluteHttpsOrigin)
}).strict().readonly()

export type OpenContentDeploymentConfiguration = z.infer<
  typeof openContentDeploymentConfigurationSchema
>

export const OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR = Object.freeze(
  deploymentConfigurationDescriptorSchema.parse(
    packageManifest.sciforgeDeploymentConfiguration
  )
)

type DeploymentConfigurationFileOperations = Readonly<{
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

const deploymentConfigurationFileOperations: DeploymentConfigurationFileOperations =
  Object.freeze({
    open: (path: string, flags: number) => openSync(path, flags),
    fstat: (fd: number) => fstatSync(fd, { bigint: true }),
    read: (
      fd: number,
      buffer: Buffer,
      offset: number,
      length: number,
      position: null
    ) => readSync(fd, buffer, offset, length, position),
    close: (fd: number) => closeSync(fd)
  })

/**
 * Resolves the package-owned deployment sidecar once during Connector
 * activation. Absence and every invalid filesystem or JSON state are the same
 * bounded outcome: this Provider deployment is unavailable.
 */
export function resolveOpenContentDeploymentConfiguration(
  host: Pick<DomainMainHost, 'getAppRoot' | 'isPackaged'>,
  fileOperations: DeploymentConfigurationFileOperations =
    deploymentConfigurationFileOperations
): OpenContentDeploymentConfiguration | undefined {
  try {
    const appRoot = host.getAppRoot?.()
    if (!appRoot || !isAbsolute(appRoot)) return undefined
    const packaged = host.isPackaged?.() === true
    const trustedRoot = packaged ? dirname(appRoot) : appRoot
    const relativePath = packaged
      ? OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.packagedResourcesRelativePath
      : OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.sourceRelativePath
    const sidecarPath = containedPath(trustedRoot, relativePath)

    assertDirectoryWithoutSymlink(trustedRoot)
    assertPathWithoutSymlink(trustedRoot, sidecarPath)
    const maxBytes = OPENCONTENT_DEPLOYMENT_CONFIGURATION_DESCRIPTOR.maxBytes
    const file = lstatSync(sidecarPath, { bigint: true })
    if (!file.isFile() || file.isSymbolicLink() ||
      file.size < 0n || file.size > BigInt(maxBytes)) {
      return undefined
    }
    const canonicalRoot = realpathSync(trustedRoot)
    const canonicalSidecar = realpathSync(sidecarPath)
    if (!isContained(canonicalRoot, canonicalSidecar)) return undefined

    let descriptor: number | undefined
    try {
      const noFollow = typeof constants.O_NOFOLLOW === 'number'
        ? constants.O_NOFOLLOW
        : 0
      descriptor = fileOperations.open(sidecarPath, constants.O_RDONLY | noFollow)
      const before = fileOperations.fstat(descriptor)
      if (!sameFileSnapshot(file, before) ||
        before.size < 0n || before.size > BigInt(maxBytes)) {
        return undefined
      }

      // The read is bounded and stays on the verified descriptor. There is no
      // environment, argv, settings, renderer, caller, or alternate path.
      const buffer = Buffer.alloc(maxBytes + 1)
      let bytesRead = 0
      while (bytesRead < buffer.byteLength) {
        const count = fileOperations.read(
          descriptor,
          buffer,
          bytesRead,
          buffer.byteLength - bytesRead,
          null
        )
        if (!Number.isSafeInteger(count) || count < 0) return undefined
        if (count === 0) break
        bytesRead += count
      }
      const after = fileOperations.fstat(descriptor)
      if (!sameFileSnapshot(before, after) ||
        bytesRead > maxBytes || BigInt(bytesRead) !== before.size) {
        return undefined
      }

      // Bind the accepted bytes to the configured pathname as well as the
      // opened descriptor. A rename/replace during the read must not let a
      // stale deployment configuration retain authority.
      assertPathWithoutSymlink(trustedRoot, sidecarPath)
      const pathAfter = lstatSync(sidecarPath, { bigint: true })
      const canonicalPathAfter = realpathSync(sidecarPath)
      if (!sameFileSnapshot(after, pathAfter) ||
        pathAfter.isSymbolicLink() ||
        !isContained(canonicalRoot, canonicalPathAfter)) {
        return undefined
      }
      const parsed = openContentDeploymentConfigurationSchema.parse(
        JSON.parse(buffer.toString('utf8', 0, bytesRead))
      )
      return Object.freeze(parsed)
    } finally {
      if (descriptor !== undefined) fileOperations.close(descriptor)
    }
  } catch {
    return undefined
  }
}

function sameFileSnapshot(before: BigIntStats, after: BigIntStats): boolean {
  return after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs &&
    before.birthtimeNs === after.birthtimeNs
}

function packageRelativePathSchema() {
  return z.string().min(1).max(512).refine((value) => {
    if (isAbsolute(value) || value.includes('\\')) return false
    const segments = value.split('/')
    return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  })
}

function isAbsoluteHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.origin === value
  } catch {
    return false
  }
}

function containedPath(root: string, relativePath: string): string {
  const target = resolve(root, relativePath)
  if (!isContained(root, target)) throw new TypeError('Deployment configuration escapes its root.')
  return target
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== '' &&
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
}

function assertDirectoryWithoutSymlink(path: string): void {
  const entry = lstatSync(path)
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new TypeError('Deployment configuration root is invalid.')
  }
}

function assertPathWithoutSymlink(root: string, target: string): void {
  const pathFromRoot = relative(root, target)
  let current = root
  for (const segment of pathFromRoot.split(sep)) {
    current = resolve(current, segment)
    const entry = lstatSync(current)
    if (entry.isSymbolicLink()) {
      throw new TypeError('Deployment configuration path contains a symbolic link.')
    }
  }
}
