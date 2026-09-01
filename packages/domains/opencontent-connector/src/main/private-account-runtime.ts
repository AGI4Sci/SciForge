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

/** Ephemeral enrollment input. Implementations must clear both fields after authentication. */
export type OpenContentPrivateEnrollmentCredentials = {
  account: string
  password: string
}

export type OpenContentPrivateAccountRequestOptions = Readonly<{
  signal?: AbortSignal
}>

export type OpenContentPrivateAccountRuntime = Readonly<{
  /**
   * Authenticates through the canonical Provider client and stores only the
   * resulting session Token in the Host provider-credential store. No
   * Provider-returned profile field leaves this method.
   */
  enroll(
    input: OpenContentPrivateAccountOperation & Readonly<{
      credentials: OpenContentPrivateEnrollmentCredentials
    }>
  ): Promise<void>
  status(
    binding: OpenContentPrivateAccountBinding,
    options?: OpenContentPrivateAccountRequestOptions
  ): Promise<Readonly<{ state: 'absent' | 'available' }>>
  withSession<T>(
    binding: OpenContentPrivateAccountBinding,
    operation: (session: Readonly<{ token: string }>) => T | Promise<T>,
    options?: OpenContentPrivateAccountRequestOptions
  ): Promise<T>
  remove(
    binding: OpenContentPrivateAccountBinding,
    options?: OpenContentPrivateAccountRequestOptions
  ): Promise<void>
}>

export type OpenContentPrivateAccountErrorCode =
  | 'secure_storage_unavailable'
  | 'session_unavailable'
  | 'binding_mismatch'
  | 'cancelled'

/** Bounded, non-secret diagnostics from the Connector-owned account runtime. */
export class OpenContentPrivateAccountError extends Error {
  readonly code: OpenContentPrivateAccountErrorCode

  constructor(code: OpenContentPrivateAccountErrorCode, message: string) {
    super(message.slice(0, 256))
    this.name = 'OpenContentPrivateAccountError'
    this.code = code
  }
}
