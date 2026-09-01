import { createHash } from 'node:crypto'

import { z } from 'zod'

import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

import {
  OpenContentConnectorError,
  openContentExternalBindingAttestationSchema,
  openContentConnectionStatusSchema,
  type OpenContentConnectionStatus,
  type OpenContentExternalBindingAttestation
} from '../contract.js'
import type { OpenContentClient } from './opencontent-client.js'
import {
  OpenContentPrivateAccountError,
  type OpenContentPrivateAccountRuntime,
  type OpenContentPrivateEnrollmentCredentials
} from './private-account-runtime.js'
import { requireOpenContentDeploymentRuntime } from './runtime.js'

const OPENCONTENT_SESSION_CONNECTION_ID = 'opencontent-session' as const
const EXTERNAL_SUBJECT_DIGEST_DOMAIN =
  'sciforge.opencontent.external-binding-subject.v1' as const
const BINDING_REVISION_DIGEST_DOMAIN =
  'sciforge.opencontent.external-binding-revision.v2' as const

export type OpenContentConnectionService = Readonly<{
  enroll(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    credentials: OpenContentPrivateEnrollmentCredentials
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentConnectionStatus>
  status(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentConnectionStatus>
  attestExternalBinding(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    assertPrincipalCurrent(): void | Promise<void>
    signal?: AbortSignal
  }>): Promise<OpenContentExternalBindingAttestation>
  useCurrentSession<T>(
    input: Readonly<{
      principal: PrincipalSnapshot
      providerInstanceRef: string
      expectedBindingAttestation?: OpenContentExternalBindingAttestation
      assertPrincipalCurrent(): void | Promise<void>
      signal?: AbortSignal
    }>,
    operation: (session: Readonly<{
      token: string
      externalIdentityId: number
      bindingAttestation: OpenContentExternalBindingAttestation
    }>) => T | Promise<T>
  ): Promise<T>
  unbind(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{
    state: 'disconnected'
    remoteRevocation: 'unsupported'
  }>>
}>

export function createOpenContentConnectionService(options: Readonly<{
  providerInstanceRef: string
  accounts: OpenContentPrivateAccountRuntime
  getRuntime(): Readonly<{ client: OpenContentClient }> | undefined
}>): OpenContentConnectionService {
  const providerInstanceRef = z.string().trim().min(3).max(256)
    .parse(options.providerInstanceRef)
  const accountBinding = (principal: PrincipalSnapshot) => Object.freeze({
    principal,
    providerInstanceRef,
    connectionId: OPENCONTENT_SESSION_CONNECTION_ID
  })
  let operationTail = Promise.resolve()
  let serializedOperationCount = 0
  let enrollmentActive = false

  const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
    serializedOperationCount += 1
    const previous = operationTail
    let release!: () => void
    operationTail = new Promise<void>((resolve) => { release = resolve })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      serializedOperationCount -= 1
      release()
    }
  }

  const status: OpenContentConnectionService['status'] = async (input) => {
    requireConfiguredProviderInstance(input.providerInstanceRef, providerInstanceRef)
    const { client } = requireOpenContentDeploymentRuntime(options.getRuntime)
    return serialize(async () => {
      await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
      const binding = accountBinding(input.principal)
      const credential = await options.accounts.status(binding, { signal: input.signal })
      await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
      if (credential.state === 'absent') return Object.freeze({ state: 'disconnected' })

      try {
        const validSession = await options.accounts.withSession(
          binding,
          async ({ token }) => {
            await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
            const valid = await client.isTokenValid({
              token,
              signal: input.signal,
              assertPrincipalCurrent: input.assertPrincipalCurrent
            })
            await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
            if (!valid) return undefined
            await client.observeCurrentExternalAccount({
              token,
              signal: input.signal,
              assertPrincipalCurrent: input.assertPrincipalCurrent
            })
            await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
            return true
          },
          { signal: input.signal }
        )
        return validSession
          ? connectedStatus(providerInstanceRef)
          : reauthenticationStatus(providerInstanceRef)
      } catch (error) {
        if (isMissingCredential(error)) return Object.freeze({ state: 'disconnected' })
        if (isInvalidProviderSession(error)) return reauthenticationStatus(providerInstanceRef)
        throw error
      }
    })
  }

  const useCurrentSession: OpenContentConnectionService['useCurrentSession'] = async (
    input,
    operation
  ) => {
    requireConfiguredProviderInstance(input.providerInstanceRef, providerInstanceRef)
    const { client } = requireOpenContentDeploymentRuntime(options.getRuntime)
    try {
      return await serialize(async () => options.accounts.withSession(
        accountBinding(input.principal),
        async ({ token }) => {
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          const valid = await client.isTokenValid({
            token,
            signal: input.signal,
            assertPrincipalCurrent: input.assertPrincipalCurrent
          })
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          if (!valid) throw reauthenticationRequired()
          const observedAccount = await client.observeCurrentExternalAccount({
            token,
            signal: input.signal,
            assertPrincipalCurrent: input.assertPrincipalCurrent
          })
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          const bindingAttestation = createExternalBindingAttestation({
            providerInstanceRef,
            principal: input.principal,
            token,
            externalAccount: observedAccount
          })
          if (
            input.expectedBindingAttestation !== undefined &&
            !sameExternalBindingAttestation(
              input.expectedBindingAttestation,
              bindingAttestation
            )
          ) throw bindingAttestationMismatch()
          return operation(Object.freeze({
            token,
            externalIdentityId: observedAccount.identityId,
            bindingAttestation
          }))
        },
        { signal: input.signal }
      ))
    } catch (error) {
      if (!isMissingCredential(error) && !isInvalidProviderSession(error)) throw error
      throw reauthenticationRequired()
    }
  }

  const attestExternalBinding: OpenContentConnectionService['attestExternalBinding'] = (
    input
  ) => useCurrentSession(input, ({ bindingAttestation }) => bindingAttestation)

  return Object.freeze({
    status,
    attestExternalBinding,
    useCurrentSession,
    unbind: async (input) => {
      requireConfiguredProviderInstance(input.providerInstanceRef, providerInstanceRef)
      return serialize(async () => {
        assertOperationNotCancelled(input.signal)
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        await options.accounts.remove(
          accountBinding(input.principal),
          { signal: input.signal }
        )
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        return Object.freeze({
          state: 'disconnected' as const,
          remoteRevocation: 'unsupported' as const
        })
      })
    },
    enroll: async (input) => {
      let ownsEnrollmentSlot = false
      try {
        requireConfiguredProviderInstance(input.providerInstanceRef, providerInstanceRef)
        if (enrollmentActive || serializedOperationCount > 0) throw enrollmentConflict()
        enrollmentActive = true
        ownsEnrollmentSlot = true
        requireOpenContentDeploymentRuntime(options.getRuntime)
        return await serialize(async () => {
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          const binding = accountBinding(input.principal)
          await options.accounts.enroll({
            ...binding,
            credentials: input.credentials,
            signal: input.signal,
            assertPrincipalCurrent: input.assertPrincipalCurrent
          })
          return connectedStatus(providerInstanceRef)
        })
      } finally {
        clearEnrollmentCredentials(input.credentials)
        if (ownsEnrollmentSlot) enrollmentActive = false
      }
    }
  })
}

function connectedStatus(providerInstanceRef: string): OpenContentConnectionStatus {
  return Object.freeze(openContentConnectionStatusSchema.parse({
    state: 'connected',
    providerInstanceRef
  }))
}

function reauthenticationStatus(providerInstanceRef: string): OpenContentConnectionStatus {
  return Object.freeze(openContentConnectionStatusSchema.parse({
    state: 'reauthentication_required',
    providerInstanceRef
  }))
}

function createExternalBindingAttestation(input: Readonly<{
  providerInstanceRef: string
  principal: PrincipalSnapshot
  token: string
  externalAccount: Readonly<{ id: string; identityId: number }>
}>): OpenContentExternalBindingAttestation {
  const externalSubject = digestBindingParts([
    EXTERNAL_SUBJECT_DIGEST_DOMAIN,
    input.providerInstanceRef,
    input.externalAccount.id,
    String(input.externalAccount.identityId)
  ])
  return Object.freeze(openContentExternalBindingAttestationSchema.parse({
    providerInstanceRef: input.providerInstanceRef,
    principal: input.principal,
    externalSubject,
    bindingRevision: digestBindingParts([
      BINDING_REVISION_DIGEST_DOMAIN,
      input.providerInstanceRef,
      input.token,
      externalSubject
    ])
  }))
}

function digestBindingParts(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')
}

function sameExternalBindingAttestation(
  rawExpected: OpenContentExternalBindingAttestation,
  actual: OpenContentExternalBindingAttestation
): boolean {
  const expected = openContentExternalBindingAttestationSchema.safeParse(rawExpected)
  if (!expected.success) return false
  return expected.data.providerInstanceRef === actual.providerInstanceRef &&
    expected.data.externalSubject === actual.externalSubject &&
    expected.data.bindingRevision === actual.bindingRevision &&
    expected.data.principal.authority === actual.principal.authority &&
    expected.data.principal.subject === actual.principal.subject &&
    expected.data.principal.assurance === actual.principal.assurance &&
    expected.data.principal.deviceId === actual.principal.deviceId &&
    expected.data.principal.identityVersion === actual.principal.identityVersion
}

function clearEnrollmentCredentials(credentials: OpenContentPrivateEnrollmentCredentials): void {
  if (!credentials || typeof credentials !== 'object') return
  credentials.account = ''
  credentials.password = ''
}

function isMissingCredential(error: unknown): boolean {
  return error instanceof OpenContentPrivateAccountError && (
    error.code === 'session_unavailable' || error.code === 'binding_mismatch'
  )
}

function isInvalidProviderSession(error: unknown): boolean {
  return error instanceof OpenContentConnectorError &&
    error.code === 'reauthentication_required'
}

/**
 * Converts the Host-owned lease assertion into the Connector's bounded error
 * vocabulary without retaining or exposing Host identity diagnostics.
 */
export async function assertOpenContentPrincipalCurrent(
  assertion: () => void | Promise<void>
): Promise<void> {
  try {
    await assertion()
  } catch {
    throw new OpenContentConnectorError(
      'unauthorized',
      'The Host Principal is no longer current for this OpenContent session.'
    )
  }
}

function reauthenticationRequired(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'reauthentication_required',
    'The OpenContent connection must be authenticated again.'
  )
}

function bindingAttestationMismatch(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'unauthorized',
    'The expected OpenContent external binding is no longer current.'
  )
}

function enrollmentConflict(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'conflict',
    'Another OpenContent connection operation is already in progress.'
  )
}

function assertOperationNotCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new OpenContentConnectorError(
    'cancelled',
    'The OpenContent connection operation was cancelled.'
  )
}

function requireConfiguredProviderInstance(
  selectedProviderInstanceRef: string,
  installedProviderInstanceRef: string
): void {
  if (selectedProviderInstanceRef !== installedProviderInstanceRef) {
    throw new OpenContentConnectorError(
      'invalid_input',
      'The selected OpenContent Provider Instance is not installed.'
    )
  }
}
