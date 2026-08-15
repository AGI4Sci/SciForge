import { z } from 'zod'

import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from './contract.js'

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
}>

/** Exact owner-scoped storage pair minted by generated main composition. */
export type DomainMainPackageStorageHost = Readonly<{
  settings: DomainMainPackageSettingsHost
  secrets: DomainMainPackageSecretStoreHost
}>
