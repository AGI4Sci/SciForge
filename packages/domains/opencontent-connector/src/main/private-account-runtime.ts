import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

export type OpenContentPrivateAccountBinding = Readonly<{
  principal: PrincipalSnapshot
  providerInstanceRef: string
  connectionId: string
}>

export type OpenContentPrivateAccountOperation = Readonly<{
  principal: PrincipalSnapshot
  providerInstanceRef: string
  connectionId: string
  signal?: AbortSignal
  assertPrincipalCurrent(): void | Promise<void>
}>

export type OpenContentPrivateEnrollmentReceipt = Readonly<{
  externalAccount: Readonly<{
    id: string
    identityId: number
    account: string
    name: string
  }>
}>

export type OpenContentPrivateAccountRuntime = Readonly<{
  /**
   * Collects account authentication in the Connector-owned native prompt,
   * authenticates through the canonical Provider client, and stores the
   * resulting session in the Connector-owned native vault. Only non-secret
   * connection metadata leaves this method.
   */
  enroll(
    input: OpenContentPrivateAccountOperation
  ): Promise<OpenContentPrivateEnrollmentReceipt>
  status(
    binding: OpenContentPrivateAccountBinding
  ): Promise<Readonly<{ state: 'absent' | 'available' }>>
  withSession<T>(
    binding: OpenContentPrivateAccountBinding,
    operation: (session: Readonly<{ token: string }>) => T | Promise<T>
  ): Promise<T>
  remove(binding: OpenContentPrivateAccountBinding): Promise<void>
}>

export type OpenContentPrivateAccountErrorCode =
  | 'native_enrollment_unavailable'
  | 'secure_storage_unavailable'
  | 'session_unavailable'
  | 'binding_mismatch'
  | 'cancelled'

/** Bounded, non-secret diagnostics from the Connector-owned native boundary. */
export class OpenContentPrivateAccountError extends Error {
  readonly code: OpenContentPrivateAccountErrorCode

  constructor(code: OpenContentPrivateAccountErrorCode, message: string) {
    super(message.slice(0, 256))
    this.name = 'OpenContentPrivateAccountError'
    this.code = code
  }
}
