import { z } from 'zod'

import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from './contract.js'
import { principalSnapshotSchema } from './principal.js'

export const domainMainPackageSettingsSnapshotSchema = z.object({
  revision: z.number().int().nonnegative().safe(),
  value: domainPackageJsonValueSchema.nullable()
}).strict()

export type DomainMainPackageSettingsSnapshot = z.infer<
  typeof domainMainPackageSettingsSnapshotSchema
>

/**
 * Package-scoped, non-secret settings document.
 *
 * The Host binds this port to the activating package owner. Packages cannot
 * choose a namespace or inspect another package's settings. Writes use an
 * exact revision so renderer-triggered capability calls cannot silently lose
 * a concurrent main-process update.
 */
export type DomainMainPackageSettingsHost = Readonly<{
  read: () => Promise<DomainMainPackageSettingsSnapshot>
  write: (
    value: DomainPackageJsonValue,
    expectedRevision: number
  ) => Promise<DomainMainPackageSettingsSnapshot>
  clear: (expectedRevision: number) => Promise<DomainMainPackageSettingsSnapshot>
}>

export const domainMainPackageSecretKeySchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/,
    'Use a package-local lowercase secret key.'
  )

export type DomainMainPackageSecretKey = z.infer<
  typeof domainMainPackageSecretKeySchema
>

export const domainMainProviderCredentialBindingSchema = z.object({
  providerInstanceRef: z.string()
    .min(3)
    .max(256)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]+$/u),
  connectionId: z.string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
}).strict().readonly()

export type DomainMainProviderCredentialBinding = z.infer<
  typeof domainMainProviderCredentialBindingSchema
>

export const domainMainProviderCredentialAccessSchema = z.object({
  binding: domainMainProviderCredentialBindingSchema,
  /** Host-captured lease assertion; the Host-current Principal still selects the namespace. */
  expectedPrincipal: principalSnapshotSchema
}).strict().readonly()

export type DomainMainProviderCredentialAccess = z.infer<
  typeof domainMainProviderCredentialAccessSchema
>

export const domainMainProviderCredentialStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('absent') }).strict().readonly(),
  z.object({
    state: z.literal('available'),
    recordVersion: z.literal(1)
  }).strict().readonly()
])

export type DomainMainProviderCredentialStatus = z.infer<
  typeof domainMainProviderCredentialStatusSchema
>

export type DomainMainProviderCredentialOperationOptions = Readonly<{
  signal?: AbortSignal
}>

export type DomainMainProviderCredentialErrorCode =
  | 'principal_unavailable'
  | 'principal_device_mismatch'
  | 'credential_unavailable'
  | 'credential_binding_mismatch'
  | 'secure_storage_unavailable'
  | 'secure_storage_insecure'
  | 'secure_storage_corrupt'
  | 'secure_storage_undecryptable'

export class DomainMainProviderCredentialError extends Error {
  readonly code: DomainMainProviderCredentialErrorCode

  constructor(code: DomainMainProviderCredentialErrorCode, message: string) {
    super(message.slice(0, 256))
    this.name = 'DomainMainProviderCredentialError'
    this.code = code
  }
}

/**
 * Bounded provider-credential use on top of the package's canonical encrypted
 * secret store. Owner, node, and current Principal are supplied by Host
 * composition. A package names its local provider binding and presents the
 * exact Principal lease that the Host must atomically re-verify.
 */
export type DomainMainProviderCredentialStoreHost = Readonly<{
  status: (
    access: DomainMainProviderCredentialAccess,
    options?: DomainMainProviderCredentialOperationOptions
  ) => Promise<DomainMainProviderCredentialStatus>
  replace: (
    access: DomainMainProviderCredentialAccess,
    secret: string,
    options?: DomainMainProviderCredentialOperationOptions
  ) => Promise<void>
  use: <T>(
    access: DomainMainProviderCredentialAccess,
    operation: (secret: string) => T | Promise<T>,
    options?: DomainMainProviderCredentialOperationOptions
  ) => Promise<T>
  remove: (
    access: DomainMainProviderCredentialAccess,
    options?: DomainMainProviderCredentialOperationOptions
  ) => Promise<void>
}>

/**
 * Package-scoped secret storage available only in the trusted main process.
 *
 * Secret values must remain opaque in Host diagnostics and persistence outside
 * the platform secret backend. The interface deliberately has no list/export
 * operation, and renderer code receives neither this port nor secret values.
 */
export type DomainMainPackageSecretStoreHost = Readonly<{
  has: (key: DomainMainPackageSecretKey) => Promise<boolean>
  read: (key: DomainMainPackageSecretKey) => Promise<string | null>
  write: (key: DomainMainPackageSecretKey, value: string) => Promise<void>
  remove: (key: DomainMainPackageSecretKey) => Promise<void>
  /** Introduced in Host API 1.4; absent hosts fail closed for provider enrollment. */
  providerCredentials?: DomainMainProviderCredentialStoreHost
}>

/** Exact owner-scoped storage pair minted by generated main composition. */
export type DomainMainPackageStorageHost = Readonly<{
  settings: DomainMainPackageSettingsHost
  secrets: DomainMainPackageSecretStoreHost
}>
