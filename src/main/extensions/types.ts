import type { KeyObject } from 'node:crypto'
import type { SandboxedDomainPackageDefinition } from '@sciforge/domain-sdk'

export const EXTENSION_INTEGRITY_PATH = 'META-INF/sciforge-integrity.json'
export const EXTENSION_SIGNATURE_PATH = 'META-INF/sciforge-signature.json'
export const EXTENSION_DOMAIN_MANIFEST_PATH = 'sciforge.domain.json'

export type ExtensionArtifactSource =
  | string
  | Readonly<{ kind: 'directory'; path: string }>
  | Readonly<{ kind: 'zip'; path: string }>
  | Readonly<{ kind: 'zip-bytes'; bytes: Uint8Array; label?: string }>

export type ExtensionArtifactLimits = Readonly<{
  maxArchiveBytes: number
  maxUnpackedBytes: number
  maxFileBytes: number
  maxFiles: number
}>

export const DEFAULT_EXTENSION_ARTIFACT_LIMITS: ExtensionArtifactLimits = Object.freeze({
  maxArchiveBytes: 128 * 1024 * 1024,
  maxUnpackedBytes: 256 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  maxFiles: 10_000
})

export type TrustedOfficialPublisherKey = Readonly<{
  keyId: string
  publisherId: string
  publicKey: KeyObject | string | Buffer
}>

export type TrustedOfficialPublisherKeyring =
  | ReadonlyMap<string, Omit<TrustedOfficialPublisherKey, 'keyId'>>
  | Readonly<Record<string, Omit<TrustedOfficialPublisherKey, 'keyId'>>>
  | readonly TrustedOfficialPublisherKey[]

export type ExtensionIntegrityManifest = Readonly<{
  schemaVersion: 1
  packageName: string
  version: string
  publisherId: string
  files: Readonly<Record<string, string>>
}>

export type ExtensionSignatureDescriptor = Readonly<{
  schemaVersion: 1
  algorithm: 'ed25519'
  keyId: string
  signature: string
}>

export type VerifiedExtensionArtifact = Readonly<{
  definition: SandboxedDomainPackageDefinition
  integrity: ExtensionIntegrityManifest
  integritySha256: string
  signer: Readonly<{
    publisherId: string
    keyId: string
    trust: 'official'
    algorithm: 'ed25519'
  }>
  files: ReadonlyMap<string, Buffer>
}>

export type ExtensionExecutionSecurity = Readonly<{
  trust: 'official'
  codeIsolation: 'extension-host'
  rendererIsolation: 'sandboxed-webview'
  capabilityAccess: 'brokered'
  thirdPartyReady: true
}>

export type InstalledExtensionRuntimeMetadata = Readonly<{
  kind: 'sandboxed-runtime'
  requestedPermissions: readonly SandboxedDomainPackageDefinition['requestedPermissions'][number][]
  entrypoints: readonly SandboxedDomainPackageDefinition['entrypoints'][number][]
}>

export type InstalledExtensionVersion = Readonly<{
  version: string
  installedAt: string
  integritySha256: string
  signer: VerifiedExtensionArtifact['signer']
  executionSecurity: ExtensionExecutionSecurity
  runtime: InstalledExtensionRuntimeMetadata
}>

export type InstalledExtensionPackage = Readonly<{
  packageName: string
  moduleId: string
  publisherId: string
  publisherDisplayName: string
  displayName: string
  enabled: boolean
  activeVersion: string
  versions: readonly InstalledExtensionVersion[]
}>

export type InstalledExtensionStatus = Readonly<{
  package: InstalledExtensionPackage
  active: InstalledExtensionVersion
  installPath: string
  health: 'ready' | 'missing' | 'corrupt'
  issue?: string
}>
