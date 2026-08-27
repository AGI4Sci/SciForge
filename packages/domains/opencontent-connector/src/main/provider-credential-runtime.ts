import {
  DomainMainProviderCredentialError,
  domainMainProviderCredentialAccessSchema,
  domainMainProviderCredentialBindingSchema,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import {
  principalSnapshotSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

import {
  OpenContentConnectorError,
  type OpenContentConnectorErrorCode
} from '../contract.js'
import type { OpenContentClient } from './opencontent-client.js'
import { assertNoOpenContentSessionTokenEcho } from './session-material-guard.js'
import {
  OpenContentPrivateAccountError,
  type OpenContentPrivateAccountBinding,
  type OpenContentPrivateAccountRuntime,
  type OpenContentPrivateAccountErrorCode,
  type OpenContentPrivateEnrollmentCredentials
} from './private-account-runtime.js'
import { requireOpenContentDeploymentRuntime } from './runtime.js'

const TOKEN_MIN_LENGTH = 16
const TOKEN_MAX_LENGTH = 4096
const ENROLLMENT_NETWORK_TIMEOUT_MS = 60_000
const SCHEMA_VALIDATION_PROVIDER_INSTANCE_REF = 'opencontent.schema-validation'
const SCHEMA_VALIDATION_CONNECTION_ID = 'schema-validation'

export type OpenContentPrivateAccountRuntimeOptions = Readonly<{
  providerInstanceRef: string
  credentials?: DomainMainProviderCredentialStoreHost
  getRuntime(): Readonly<{ client: OpenContentClient }> | undefined
}>

/** Canonical main-process enrollment and encrypted Session Token runtime. */
export function createOpenContentPrivateAccountRuntime(
  options: OpenContentPrivateAccountRuntimeOptions
): OpenContentPrivateAccountRuntime {
  const providerInstanceRef = requireConfiguredProviderInstanceRef(
    options.providerInstanceRef
  )

  return Object.freeze({
    enroll: async (input) => {
      const credentials = requireEnrollmentCredentials(input.credentials)
      try {
        requireSelectedProviderInstance(input.providerInstanceRef, providerInstanceRef)
        requirePrincipal(input.principal)
        requireConnectionId(input.connectionId)
      } catch (error) {
        clearCredentials(credentials)
        throw error
      }
      let sessionToken = ''
      try {
        await assertPrincipalCurrent(input.assertPrincipalCurrent)
        assertNotCancelled(input.signal)
        const access = credentialAccess({
          principal: input.principal,
          providerInstanceRef: input.providerInstanceRef,
          connectionId: input.connectionId
        })
        await invokeCredentialStore(() => credentialStore(options).status(
          access,
          { signal: input.signal }
        ))
        const runtime = requireOpenContentDeploymentRuntime(options.getRuntime)
        const timeout = AbortSignal.timeout(ENROLLMENT_NETWORK_TIMEOUT_MS)
        const enrollmentSignal = input.signal
          ? AbortSignal.any([input.signal, timeout])
          : timeout
        const authenticationInput = {
          username: credentials.account,
          password: credentials.password,
          signal: enrollmentSignal,
          assertPrincipalCurrent: input.assertPrincipalCurrent
        }
        const authentication = (() => {
          try {
            return runtime.client.authenticateExistingAccount(authenticationInput)
          } finally {
            authenticationInput.username = ''
            authenticationInput.password = ''
            clearCredentials(credentials)
          }
        })()
        try {
          try {
            const authenticated = await authentication
            sessionToken = requireSessionSecret(authenticated.token)
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
          try {
            await runtime.client.observeCurrentExternalAccount({
              token: sessionToken,
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
          await invokeCredentialStore(() => credentialStore(options).replace(
            access,
            sessionToken,
            { signal: input.signal }
          ))
          return undefined
        } finally {
          sessionToken = ''
        }
      } finally {
        clearCredentials(credentials)
      }
    },
    status: async (rawBinding, requestOptions) => {
      const binding = requireBinding(rawBinding, providerInstanceRef)
      const status = await invokeCredentialStore(() => credentialStore(options).status(
        credentialAccess(binding),
        { signal: requestOptions?.signal }
      ))
      return Object.freeze({ state: status.state })
    },
    withSession: async (rawBinding, operation, requestOptions) => {
      const binding = requireBinding(rawBinding, providerInstanceRef)
      let callbackFailure: OpenContentSessionCallbackFailure | undefined
      try {
        return await invokeCredentialStore(() => credentialStore(options).use(
          credentialAccess(binding),
          async (rawSecret) => {
            let secret = requireSessionSecret(rawSecret)
            try {
              try {
                const result = await operation(Object.freeze({ token: secret }))
                assertNoOpenContentSessionTokenEcho(result, secret)
                return result
              } catch (error) {
                callbackFailure = classifySessionCallbackFailure(error)
                throw new Error('The protected OpenContent operation failed.')
              }
            } finally {
              secret = ''
            }
          },
          { signal: requestOptions?.signal }
        ))
      } catch (error) {
        if (callbackFailure) throw rebuildSessionCallbackFailure(callbackFailure)
        throw error
      } finally {
        callbackFailure = undefined
      }
    },
    remove: async (rawBinding, requestOptions) => {
      const binding = requireBinding(rawBinding, providerInstanceRef)
      await invokeCredentialStore(() => credentialStore(options).remove(
        credentialAccess(binding),
        { signal: requestOptions?.signal }
      ))
    }
  })
}

type OpenContentSessionCallbackFailure =
  | Readonly<{
      family: 'connector'
      code: OpenContentConnectorErrorCode
    }>
  | Readonly<{
      family: 'account'
      code: OpenContentPrivateAccountErrorCode
    }>
  | Readonly<{ family: 'unknown' }>

const CONNECTOR_CALLBACK_ERROR_CODES: readonly OpenContentConnectorErrorCode[] = [
  'invalid_input',
  'unauthorized',
  'reauthentication_required',
  'provider_unavailable',
  'rate_limited',
  'provider_contract_violation',
  'conflict',
  'outcome_unknown',
  'bounds_exceeded',
  'cancelled'
]

const ACCOUNT_CALLBACK_ERROR_CODES: readonly OpenContentPrivateAccountErrorCode[] = [
  'secure_storage_unavailable',
  'session_unavailable',
  'binding_mismatch',
  'cancelled'
]

function classifySessionCallbackFailure(error: unknown): OpenContentSessionCallbackFailure {
  try {
    if (error instanceof OpenContentConnectorError) {
      const code = ownDataProperty(error, 'code')
      if (isConnectorCallbackErrorCode(code)) {
        return Object.freeze({ family: 'connector', code })
      }
    }
    if (error instanceof OpenContentPrivateAccountError) {
      const code = ownDataProperty(error, 'code')
      if (isAccountCallbackErrorCode(code)) {
        return Object.freeze({ family: 'account', code })
      }
    }
  } catch {
    // Host must receive neither hostile getters nor their captured values.
  }
  return Object.freeze({ family: 'unknown' })
}

function ownDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function rebuildSessionCallbackFailure(
  failure: OpenContentSessionCallbackFailure
): OpenContentConnectorError | OpenContentPrivateAccountError {
  if (failure.family === 'connector') {
    return new OpenContentConnectorError(
      failure.code,
      'The protected OpenContent operation failed.'
    )
  }
  if (failure.family === 'account') {
    return new OpenContentPrivateAccountError(
      failure.code,
      'The protected OpenContent account operation failed.'
    )
  }
  return new OpenContentConnectorError(
    'provider_unavailable',
    'The OpenContent Provider operation failed.'
  )
}

function isConnectorCallbackErrorCode(
  value: unknown
): value is OpenContentConnectorErrorCode {
  return typeof value === 'string' &&
    CONNECTOR_CALLBACK_ERROR_CODES.includes(value as OpenContentConnectorErrorCode)
}

function isAccountCallbackErrorCode(
  value: unknown
): value is OpenContentPrivateAccountErrorCode {
  return typeof value === 'string' &&
    ACCOUNT_CALLBACK_ERROR_CODES.includes(value as OpenContentPrivateAccountErrorCode)
}

function credentialStore(
  options: OpenContentPrivateAccountRuntimeOptions
): DomainMainProviderCredentialStoreHost {
  if (options.credentials) return options.credentials
  throw new OpenContentPrivateAccountError(
    'secure_storage_unavailable',
    'Secure OpenContent Session storage is unavailable.'
  )
}

function credentialAccess(binding: OpenContentPrivateAccountBinding) {
  return domainMainProviderCredentialAccessSchema.parse({
    binding: {
      providerInstanceRef: binding.providerInstanceRef,
      connectionId: binding.connectionId
    },
    expectedPrincipal: binding.principal
  })
}

function requireBinding(
  rawBinding: OpenContentPrivateAccountBinding,
  configuredProviderInstanceRef: string
): OpenContentPrivateAccountBinding {
  const providerInstanceRef = requireConfiguredProviderInstanceRef(
    rawBinding.providerInstanceRef
  )
  if (providerInstanceRef !== configuredProviderInstanceRef) throw bindingMismatch()
  return Object.freeze({
    principal: requirePrincipal(rawBinding.principal),
    providerInstanceRef,
    connectionId: requireConnectionId(rawBinding.connectionId)
  })
}

function requireConfiguredProviderInstanceRef(rawProviderInstanceRef: string): string {
  const parsed = domainMainProviderCredentialBindingSchema.safeParse({
    providerInstanceRef: rawProviderInstanceRef,
    connectionId: SCHEMA_VALIDATION_CONNECTION_ID
  })
  if (!parsed.success) throw bindingMismatch()
  return parsed.data.providerInstanceRef
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
  const parsed = domainMainProviderCredentialBindingSchema.safeParse({
    providerInstanceRef: SCHEMA_VALIDATION_PROVIDER_INSTANCE_REF,
    connectionId: rawConnectionId
  })
  if (!parsed.success) throw bindingMismatch()
  return parsed.data.connectionId
}

function requireEnrollmentCredentials(
  credentials: OpenContentPrivateEnrollmentCredentials
): OpenContentPrivateEnrollmentCredentials {
  if (
    typeof credentials !== 'object' ||
    credentials === null ||
    typeof credentials.account !== 'string' ||
    credentials.account.trim().length < 1 ||
    credentials.account.length > 256 ||
    typeof credentials.password !== 'string' ||
    credentials.password.length < 1 ||
    credentials.password.length > 4096
  ) {
    clearCredentials(credentials)
    throw new TypeError('OpenContent enrollment credentials are invalid.')
  }
  return credentials
}

function clearCredentials(credentials: OpenContentPrivateEnrollmentCredentials): void {
  if (!credentials || typeof credentials !== 'object') return
  credentials.account = ''
  credentials.password = ''
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
      'The OpenContent Session Token in secure storage is invalid.'
    )
  }
  return secret
}

async function invokeCredentialStore<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof OpenContentPrivateAccountError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OpenContentPrivateAccountError(
        'cancelled',
        'The OpenContent account operation was cancelled.'
      )
    }
    if (error instanceof DomainMainProviderCredentialError) {
      if (error.code === 'credential_unavailable') {
        throw new OpenContentPrivateAccountError(
          'session_unavailable',
          'The OpenContent account Session is unavailable.'
        )
      }
      if (
        error.code === 'principal_unavailable' ||
        error.code === 'principal_device_mismatch' ||
        error.code === 'credential_binding_mismatch'
      ) throw bindingMismatch()
    }
    throw new OpenContentPrivateAccountError(
      'secure_storage_unavailable',
      'Secure OpenContent Session storage is unavailable.'
    )
  }
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
