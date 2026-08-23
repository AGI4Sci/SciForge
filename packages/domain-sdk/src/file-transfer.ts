import { z } from 'zod'

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
  .refine(isControlFreeText, {
    message: 'The Workspace-relative path must not contain control characters.'
  })

export type DomainFileTransferHandle = z.infer<typeof domainFileTransferHandleSchema>
export type DomainWorkspaceRelativePath = z.infer<typeof domainWorkspaceRelativePathSchema>

export const domainFileTransferLabelSchema = z.string().min(1)
  .max(DOMAIN_FILE_TRANSFER_LIMITS.maxLabelCharacters)
  .refine((value) => value.trim().length > 0, {
    message: 'The file label must not be blank.'
  })
  .refine((value) => value !== '.' && value !== '..', {
    message: 'The file label must not be a relative path segment.'
  })
  .refine(isSafeSuggestedFileName, {
    message: 'The file label must be one safe file name.'
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
   * Agent-only canonical Workspace path. The Host derives the active Task
   * Workspace and internally mints then consumes the same one-shot grant used
   * by renderer pickers; packages never receive an absolute path.
   */
  openWorkspaceUploadSource(input: Readonly<{
    relativePath: DomainWorkspaceRelativePath
    maxBytes: number
    signal?: AbortSignal
  }>): Promise<DomainMainUploadSource>
  /** Agent-only, Broker-authorized, no-overwrite Workspace destination. */
  openWorkspaceDownloadDestination(input: Readonly<{
    relativePath: DomainWorkspaceRelativePath
    maxBytes: number
    signal?: AbortSignal
  }>): Promise<DomainMainDownloadDestination>
}>

function isSafeSuggestedFileName(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return false
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || codePoint === 0x7f) return false
  }
  return true
}

function isControlFreeText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x1f || codePoint === 0x7f) return false
  }
  return true
}
