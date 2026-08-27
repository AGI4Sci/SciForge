import { createHash } from 'node:crypto'

import {
  principalSnapshotSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

import { OpenContentConnectorError } from '../../contract.js'
import type { OpenContentClient } from '../opencontent-client.js'
import {
  OpenContentPrivateAccountError,
  type OpenContentPrivateAccountBinding,
  type OpenContentPrivateAccountRuntime,
  type OpenContentPrivateEnrollmentReceipt
} from '../private-account-runtime.js'
import {
  requireOpenContentDeploymentRuntime
} from '../runtime.js'
import {
  loadNativeOpenContentEnrollmentBinding,
  type NativeEnrollmentCredentials,
  type NativeOpenContentEnrollmentBinding
} from './native-binding.js'

const VAULT_KEY_DOMAIN = 'sciforge.opencontent.private-account.v1'
const CONNECTION_ID_MAX_LENGTH = 256
const TOKEN_MIN_LENGTH = 16
const TOKEN_MAX_LENGTH = 4096
const ENROLLMENT_NETWORK_TIMEOUT_MS = 60_000

export type NativeOpenContentPrivateAccountRuntimeOptions = Readonly<{
  providerInstanceRef: string
  getRuntime(): Readonly<{ client: OpenContentClient }> | undefined
  /** Test seam only. Production composition must omit this option. */
  nativeTestBinding?: Readonly<{
    platform: NodeJS.Platform
    binding: NativeOpenContentEnrollmentBinding
  }>
}>

/**
 * Creates the sole OpenContent account-enrollment and session-vault runtime.
 *
 * The returned object is package-private main-process code. Credentials are
 * collected by the native addon, consumed by the canonical Provider client,
 * and immediately discarded. Provider sessions only cross the native vault
 * boundary inside `withSession`; public status and enrollment receipts contain
 * non-secret account metadata only.
 */
export function createNativeOpenContentPrivateAccountRuntime(
  options: NativeOpenContentPrivateAccountRuntimeOptions
): OpenContentPrivateAccountRuntime {
  const providerInstanceRef = requireConfiguredProviderInstanceRef(
    options.providerInstanceRef
  )
  const platform = options.nativeTestBinding?.platform ?? process.platform
  if (platform !== 'darwin') return unavailableRuntime()

  let cachedBinding: NativeOpenContentEnrollmentBinding | undefined =
    options.nativeTestBinding?.binding
  const binding = (): NativeOpenContentEnrollmentBinding => {
    cachedBinding ??= loadNativeOpenContentEnrollmentBinding()
    return cachedBinding
  }
  let enrollmentActive = false

  return Object.freeze({
    enroll: async (input) => {
      requireSelectedProviderInstance(input.providerInstanceRef, providerInstanceRef)
      const principal = requirePrincipal(input.principal)
      const connectionId = requireConnectionId(input.connectionId)
      if (enrollmentActive) {
        throw new OpenContentConnectorError(
          'conflict',
          'Another OpenContent account enrollment is already in progress.'
        )
      }
      enrollmentActive = true
      try {
        await assertPrincipalCurrent(input.assertPrincipalCurrent)
        assertNotCancelled(input.signal)
        const runtime = requireOpenContentDeploymentRuntime(options.getRuntime)

        const credentials = promptForCredentials(binding())
        try {
          await assertPrincipalCurrent(input.assertPrincipalCurrent)
          assertNotCancelled(input.signal)
          const timeout = AbortSignal.timeout(ENROLLMENT_NETWORK_TIMEOUT_MS)
          const enrollmentSignal = input.signal
            ? AbortSignal.any([input.signal, timeout])
            : timeout
          let session: Awaited<ReturnType<OpenContentClient['authenticateExistingAccount']>>
          try {
            session = await runtime.client.authenticateExistingAccount({
              username: credentials.username,
              password: credentials.password,
              signal: enrollmentSignal,
              assertPrincipalCurrent: input.assertPrincipalCurrent
            })
          } catch (error) {
            if (timeout.aborted && !input.signal?.aborted) {
              throw new OpenContentConnectorError(
                'provider_unavailable',
                'OpenContent account enrollment timed out.'
              )
            }
            throw error
          }
          await assertPrincipalCurrent(input.assertPrincipalCurrent)
          assertNotCancelled(input.signal)

          const vaultKey = deriveVaultKey({
            principal,
            providerInstanceRef: input.providerInstanceRef,
            connectionId
          })
          invokeNative(
            () => binding().storeSecret(vaultKey, requireSessionSecret(session.token)),
            'secure_storage_unavailable'
          )
          return privateReceipt(session.account)
        } finally {
          // V8 strings are immutable, but dropping both fields prevents the
          // credential object from retaining either value after authentication.
          credentials.username = ''
          credentials.password = ''
        }
      } finally {
        enrollmentActive = false
      }
    },
    status: async (rawBinding) => {
      const accountBinding = requireBinding(rawBinding, providerInstanceRef)
      const available = invokeNative(
        () => binding().hasSecret(deriveVaultKey(accountBinding)),
        'secure_storage_unavailable'
      )
      return Object.freeze({ state: available ? 'available' : 'absent' })
    },
    withSession: async (rawBinding, operation) => {
      const accountBinding = requireBinding(rawBinding, providerInstanceRef)
      let secret = invokeNative(
        () => binding().readSecret(deriveVaultKey(accountBinding)),
        'secure_storage_unavailable'
      )
      if (secret === null) {
        throw new OpenContentPrivateAccountError(
          'session_unavailable',
          'The OpenContent account session is unavailable.'
        )
      }
      secret = requireSessionSecret(secret)
      try {
        return await operation(Object.freeze({ token: secret }))
      } finally {
        secret = ''
      }
    },
    remove: async (rawBinding) => {
      const accountBinding = requireBinding(rawBinding, providerInstanceRef)
      invokeNative(
        () => binding().deleteSecret(deriveVaultKey(accountBinding)),
        'secure_storage_unavailable'
      )
    }
  })
}

function unavailableRuntime(): OpenContentPrivateAccountRuntime {
  const unavailable = (): never => {
    throw new OpenContentPrivateAccountError(
      'native_enrollment_unavailable',
      'Native OpenContent account enrollment is unavailable.'
    )
  }
  return Object.freeze({
    enroll: async () => unavailable(),
    status: async () => unavailable(),
    withSession: async () => unavailable(),
    remove: async () => unavailable()
  })
}

function promptForCredentials(
  binding: NativeOpenContentEnrollmentBinding
): NativeEnrollmentCredentials {
  const credentials = invokeNative(
    () => binding.promptCredentials(),
    'native_enrollment_unavailable'
  )
  if (credentials === null) {
    throw new OpenContentPrivateAccountError(
      'cancelled',
      'OpenContent account enrollment was cancelled.'
    )
  }
  if (
    typeof credentials !== 'object' ||
    typeof credentials.username !== 'string' ||
    credentials.username.trim().length < 1 ||
    credentials.username.length > 256 ||
    typeof credentials.password !== 'string' ||
    credentials.password.length < 1 ||
    credentials.password.length > 4096
  ) {
    throw new OpenContentPrivateAccountError(
      'native_enrollment_unavailable',
      'Native OpenContent account enrollment returned an invalid response.'
    )
  }
  return credentials
}

function requireBinding(
  rawBinding: OpenContentPrivateAccountBinding,
  configuredProviderInstanceRef: string
): OpenContentPrivateAccountBinding {
  const providerInstanceRef = requireConfiguredProviderInstanceRef(
    rawBinding.providerInstanceRef
  )
  if (
    providerInstanceRef !== configuredProviderInstanceRef
  ) throw bindingMismatch()
  return Object.freeze({
    principal: requirePrincipal(rawBinding.principal),
    providerInstanceRef,
    connectionId: requireConnectionId(rawBinding.connectionId)
  })
}

function requireConfiguredProviderInstanceRef(rawProviderInstanceRef: string): string {
  if (
    typeof rawProviderInstanceRef !== 'string' ||
    rawProviderInstanceRef.length < 3 ||
    rawProviderInstanceRef.length > 256 ||
    rawProviderInstanceRef !== rawProviderInstanceRef.trim() ||
    containsControlCharacter(rawProviderInstanceRef)
  ) throw bindingMismatch()
  return rawProviderInstanceRef
}

function requireSelectedProviderInstance(
  selectedProviderInstanceRef: string,
  configuredProviderInstanceRef: string
): void {
  if (
    requireConfiguredProviderInstanceRef(selectedProviderInstanceRef) !==
    configuredProviderInstanceRef
  ) throw bindingMismatch()
}

function requirePrincipal(rawPrincipal: PrincipalSnapshot): PrincipalSnapshot {
  const parsed = principalSnapshotSchema.safeParse(rawPrincipal)
  if (!parsed.success) throw bindingMismatch()
  return parsed.data
}

function requireConnectionId(rawConnectionId: string): string {
  if (
    typeof rawConnectionId !== 'string' ||
    rawConnectionId.length < 1 ||
    rawConnectionId.length > CONNECTION_ID_MAX_LENGTH ||
    rawConnectionId !== rawConnectionId.trim() ||
    containsControlCharacter(rawConnectionId)
  ) {
    throw bindingMismatch()
  }
  return rawConnectionId
}

function deriveVaultKey(binding: OpenContentPrivateAccountBinding): string {
  const principal = requirePrincipal(binding.principal)
  const hash = createHash('sha256')
  for (const part of [
    VAULT_KEY_DOMAIN,
    principal.authority,
    principal.subject,
    principal.assurance,
    principal.deviceId,
    binding.providerInstanceRef,
    binding.connectionId
  ]) {
    const bytes = Buffer.from(part, 'utf8')
    const length = Buffer.allocUnsafe(4)
    length.writeUInt32BE(bytes.byteLength)
    hash.update(length)
    hash.update(bytes)
    length.fill(0)
  }
  return hash.digest('hex')
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true
  }
  return false
}

function requireSessionSecret(secret: string): string {
  if (
    typeof secret !== 'string' ||
    secret.trim() !== secret ||
    secret.length < TOKEN_MIN_LENGTH ||
    secret.length > TOKEN_MAX_LENGTH
  ) {
    throw new OpenContentPrivateAccountError(
      'secure_storage_unavailable',
      'The OpenContent account session in secure storage is invalid.'
    )
  }
  return secret
}

function privateReceipt(
  account: Readonly<{
    id: string
    identityId: number
    account: string
    name: string
  }>
): OpenContentPrivateEnrollmentReceipt {
  return Object.freeze({
    externalAccount: Object.freeze({
      id: account.id,
      identityId: account.identityId,
      account: account.account,
      name: account.name
    })
  })
}

function invokeNative<T>(
  operation: () => T,
  fallback: 'native_enrollment_unavailable' | 'secure_storage_unavailable'
): T {
  try {
    return operation()
  } catch (error) {
    if (error instanceof OpenContentPrivateAccountError) throw error
    const code = nativeErrorCode(error)
    if (
      code === 'native_enrollment_unavailable' ||
      code === 'secure_storage_unavailable' ||
      code === 'cancelled'
    ) {
      throw new OpenContentPrivateAccountError(code, nativeErrorMessage(code))
    }
    throw new OpenContentPrivateAccountError(fallback, nativeErrorMessage(fallback))
  }
}

function nativeErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  return (error as Readonly<{ code?: unknown }>).code
}

function nativeErrorMessage(
  code: 'native_enrollment_unavailable' | 'secure_storage_unavailable' | 'cancelled'
): string {
  if (code === 'secure_storage_unavailable') {
    return 'The native OpenContent session vault is unavailable.'
  }
  if (code === 'cancelled') return 'OpenContent account enrollment was cancelled.'
  return 'Native OpenContent account enrollment is unavailable.'
}

function bindingMismatch(): OpenContentPrivateAccountError {
  return new OpenContentPrivateAccountError(
    'binding_mismatch',
    'The OpenContent account binding is invalid.'
  )
}

async function assertPrincipalCurrent(
  assertion: () => void | Promise<void>
): Promise<void> {
  try {
    await assertion()
  } catch {
    throw new OpenContentConnectorError(
      'unauthorized',
      'The signed-in SciForge Principal is no longer current.'
    )
  }
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new OpenContentPrivateAccountError(
    'cancelled',
    'OpenContent account enrollment was cancelled.'
  )
}
