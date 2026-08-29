import { z } from 'zod'
import { domainPackagePermissionIdSchema } from './contract.js'
import {
  isPortableWorkspacePathSegment,
  portableWorkspacePathComparisonKey
} from './file-transfer-portability.js'

export {
  isPortableWorkspacePathSegment,
  portableWorkspacePathComparisonKey
} from './file-transfer-portability.js'

export const DOMAIN_FILE_TRANSFER_LIMITS = Object.freeze({
  maxBytes: 1_073_741_824,
  maxChunkBytes: 1_048_576,
  maxLabelCharacters: 256,
  maxTitleCharacters: 256
})

export const domainFileTransferHandleSchema = z.string()
  .regex(/^xfer_[A-Za-z0-9_-]{32}$/u)

export const domainWorkspaceRelativePathSchema = z.string().min(1).max(4_096)
  .refine((value) => value.trim().length > 0, {
    message: 'The Workspace-relative path must not be blank.'
  })
  .refine((value) => !/^(?:[\\/]|[A-Za-z]:[\\/])/u.test(value), {
    message: 'The Workspace file path must be relative.'
  })
  .refine((value) => !value.split(/[\\/]+/u).some((segment) => (
    segment === '' || segment === '.' || segment === '..'
  )), {
    message: 'The Workspace-relative path contains an unsafe segment.'
  })
  .refine((value) => value.split(/[\\/]+/u).every(isPortableWorkspacePathSegment), {
    message: 'The Workspace-relative path contains a non-portable segment.'
  })
  .refine(isControlFreeText, {
    message: 'The Workspace-relative path must not contain control characters.'
  })

export type DomainFileTransferHandle = z.infer<typeof domainFileTransferHandleSchema>
export type DomainWorkspaceRelativePath = z.infer<typeof domainWorkspaceRelativePathSchema>

/**
 * Provider-neutral authority requested by a trusted system runtime. The Host
 * matches this exact manifest-issued grant against the current Broker
 * invocation; packages cannot supply a caller, Principal, invocation, domain,
 * or absolute Workspace root through this descriptor.
 */
export const domainSystemWorkspaceTransferAuthorizationSchema = z.object({
  requiredSystemCapabilityGrant: domainPackagePermissionIdSchema
}).strict().readonly()

export type DomainSystemWorkspaceTransferAuthorization = z.infer<
  typeof domainSystemWorkspaceTransferAuthorizationSchema
>

export const domainFileTransferLabelSchema = z.string().min(1)
  .max(DOMAIN_FILE_TRANSFER_LIMITS.maxLabelCharacters)
  .refine((value) => value.trim().length > 0, {
    message: 'The file label must not be blank.'
  })
  .refine((value) => value !== '.' && value !== '..', {
    message: 'The file label must not be a relative path segment.'
  })
  .refine(isPortableWorkspacePathSegment, {
    message: 'The file label must be one portable file name.'
  })

const domainRendererFilePickerTitleSchema = z.string()
  .min(1)
  .max(DOMAIN_FILE_TRANSFER_LIMITS.maxTitleCharacters)
  .refine((value) => value.trim().length > 0, {
    message: 'The file picker title must not be blank.'
  })
  .refine(isControlFreeText, {
    message: 'The file picker title must not contain control characters.'
  })

export const domainRendererPickUploadSourceInputSchema = z.object({
  title: domainRendererFilePickerTitleSchema,
  maxBytes: z.number().int().min(1).max(DOMAIN_FILE_TRANSFER_LIMITS.maxBytes)
}).strict().readonly()

export const domainRendererPickDownloadDestinationInputSchema = z.object({
  title: domainRendererFilePickerTitleSchema,
  suggestedName: domainFileTransferLabelSchema
}).strict().readonly()

export type DomainRendererPickUploadSourceInput = z.infer<
  typeof domainRendererPickUploadSourceInputSchema
>
export type DomainRendererPickDownloadDestinationInput = z.infer<
  typeof domainRendererPickDownloadDestinationInputSchema
>

export const domainRendererUploadSelectionSchema = z.discriminatedUnion('cancelled', [
  z.object({ cancelled: z.literal(true) }).strict(),
  z.object({
    cancelled: z.literal(false),
    handle: domainFileTransferHandleSchema,
    name: domainFileTransferLabelSchema,
    size: z.number().int().nonnegative().max(DOMAIN_FILE_TRANSFER_LIMITS.maxBytes)
  }).strict()
])

export const domainRendererDownloadSelectionSchema = z.discriminatedUnion('cancelled', [
  z.object({ cancelled: z.literal(true) }).strict(),
  z.object({
    cancelled: z.literal(false),
    handle: domainFileTransferHandleSchema,
    label: domainFileTransferLabelSchema
  }).strict()
])

export type DomainRendererUploadSelection = z.infer<
  typeof domainRendererUploadSelectionSchema
>
export type DomainRendererDownloadSelection = z.infer<
  typeof domainRendererDownloadSelectionSchema
>

export type DomainFileTransferErrorCode =
  | 'invalid_request'
  | 'capacity_exceeded'
  | 'grant_unavailable'
  | 'principal_changed'
  | 'source_unavailable'
  | 'source_changed'
  | 'destination_unavailable'
  | 'destination_conflict'
  | 'bound_exceeded'
  | 'cancelled'
  | 'already_settled'

export class DomainFileTransferError extends Error {
  readonly code: DomainFileTransferErrorCode

  constructor(code: DomainFileTransferErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DomainFileTransferError'
    this.code = code
  }
}

export type DomainRendererFileTransferHost = Readonly<{
  pickUploadSource(
    input: DomainRendererPickUploadSourceInput,
    options?: Readonly<{ signal?: AbortSignal }>
  ):
    Promise<DomainRendererUploadSelection>
  pickDownloadDestination(
    input: DomainRendererPickDownloadDestinationInput,
    options?: Readonly<{ signal?: AbortSignal }>
  ):
    Promise<DomainRendererDownloadSelection>
}>

export type DomainMainUploadSource = Readonly<{
  name: string
  size: number
  /** SHA-256 of the immutable Host-owned upload snapshot. */
  sha256: string
  read(input: Readonly<{ offset: number; length: number }>): Promise<Uint8Array>
  close(): Promise<void>
}>

export type DomainMainDownloadDestination = Readonly<{
  label: string
  write(chunk: Uint8Array): Promise<void>
  /**
   * Atomically publishes the complete file without overwriting an existing
   * target. Resolution confirms process-visible publication, not crash
   * durability across power loss; the current Host does not fsync the parent
   * directory. A cancellation or authorization failure observed after the
   * atomic publish starts can leave the destination present; callers must
   * report an unknown outcome and must not retry blindly.
   */
  commit(): Promise<void>
  /** Idempotently removes the unpublished partial file. */
  abort(): Promise<void>
}>

export type DomainMainFileTransferHost = Readonly<{
  /** Requires an active Broker invocation; caller and Principal are Host-derived. */
  openUploadSource(input: Readonly<{
    handle: DomainFileTransferHandle
    maxBytes: number
    signal?: AbortSignal
  }>): Promise<DomainMainUploadSource>
  /** Requires an active Broker invocation; caller and Principal are Host-derived. */
  openDownloadDestination(input: Readonly<{
    handle: DomainFileTransferHandle
    maxBytes: number
    signal?: AbortSignal
  }>): Promise<DomainMainDownloadDestination>
  /**
   * Canonical Workspace path. With no system authorization this retains the
   * Agent/resource-scope contract. Trusted system callers provide only the
   * exact manifest-issued grant; the Host derives every other authority field
   * from the current Broker invocation. Packages never receive an absolute
   * Workspace root.
   */
  openWorkspaceUploadSource(input: Readonly<{
    relativePath: DomainWorkspaceRelativePath
    maxBytes: number
    systemAuthorization?: DomainSystemWorkspaceTransferAuthorization
    signal?: AbortSignal
  }>): Promise<DomainMainUploadSource>
  /** Broker-authorized, no-overwrite Workspace destination. */
  openWorkspaceDownloadDestination(input: Readonly<{
    relativePath: DomainWorkspaceRelativePath
    maxBytes: number
    systemAuthorization?: DomainSystemWorkspaceTransferAuthorization
    signal?: AbortSignal
  }>): Promise<DomainMainDownloadDestination>
}>

function isControlFreeText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || codePoint === 0x7f) return false
  }
  return true
}
