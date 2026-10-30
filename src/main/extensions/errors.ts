export type ExtensionStoreErrorCode =
  | 'invalid_source'
  | 'unsafe_artifact'
  | 'artifact_too_large'
  | 'invalid_integrity_manifest'
  | 'invalid_signature'
  | 'unknown_signing_key'
  | 'publisher_mismatch'
  | 'invalid_domain_manifest'
  | 'incompatible_host_api'
  | 'install_scripts_forbidden'
  | 'duplicate_extension'
  | 'conflicting_identity'
  | 'extension_not_found'
  | 'rollback_unavailable'
  | 'corrupt_registry'

export class ExtensionStoreError extends Error {
  readonly code: ExtensionStoreErrorCode

  constructor(code: ExtensionStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ExtensionStoreError'
    this.code = code
  }
}

export function extensionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
