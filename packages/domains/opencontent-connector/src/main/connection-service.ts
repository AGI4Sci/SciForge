import { createHash, randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { DomainMainPackageSettingsHost } from '@sciforge/domain-sdk/package-storage'
import {
  principalAssuranceSchema,
  principalAuthoritySchema,
  principalSubjectSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

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
  type OpenContentPrivateAccountRuntime
} from './private-account-runtime.js'
import {
  requireOpenContentDeploymentRuntime
} from './runtime.js'

const storedPrincipalSchema = z.object({
  authority: principalAuthoritySchema,
  subject: principalSubjectSchema,
  assurance: principalAssuranceSchema,
  deviceId: z.string().trim().min(1).max(256)
}).strict()

const connectionIdSchema = z.string().trim().min(1).max(256)
const legacyProviderInstanceRefSchema = z.enum(['opencontent-default'])

const connectionRecordSchema = z.object({
  principal: storedPrincipalSchema,
  providerInstanceRef: z.string().trim().min(3).max(256),
  connectionId: connectionIdSchema,
  retiredCredentialIds: z.array(connectionIdSchema).max(256).optional(),
  externalAccount: z.object({
    id: z.string().trim().min(1).max(256),
    identityId: z.number().int().nonnegative().safe(),
    account: z.string().trim().min(1).max(256),
    name: z.string().trim().min(1).max(256)
  }).strict(),
  state: z.enum(['connected', 'reauthentication_required']),
  updatedAt: z.string().datetime({ offset: true })
}).strict()

type ConnectionRecord = z.infer<typeof connectionRecordSchema>

const legacyConnectionSettingsSchema = z.object({
  version: z.literal(1),
  connections: z.array(connectionRecordSchema).max(256)
}).strict()

const retiredConnectionRecordSchema = z.object({
  principal: storedPrincipalSchema,
  providerInstanceRef: legacyProviderInstanceRefSchema,
  credentialIds: z.array(connectionIdSchema).min(1).max(257)
}).strict()

type RetiredConnectionRecord = z.infer<typeof retiredConnectionRecordSchema>

const connectionSettingsSchema = z.object({
  version: z.literal(2),
  connections: z.array(connectionRecordSchema).max(256),
  retiredConnections: z.array(retiredConnectionRecordSchema).max(256)
}).strict()

type ConnectionSettingsSnapshot = Readonly<{
  revision: number
  connections: readonly ConnectionRecord[]
  retiredConnections: readonly RetiredConnectionRecord[]
  needsMigration: boolean
}>

export type OpenContentConnectionService = Readonly<{
  enroll(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
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
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{
    state: 'disconnected'
    remoteRevocation: 'unsupported'
  }>>
}>

export function createOpenContentConnectionService(options: Readonly<{
  providerInstanceRef: string
  settings: DomainMainPackageSettingsHost
  accounts: OpenContentPrivateAccountRuntime
  getRuntime(): Readonly<{ client: OpenContentClient }> | undefined
  createConnectionId?: () => string
  now?: () => Date
}>): OpenContentConnectionService {
  const providerInstanceRef = z.string().trim().min(3).max(256)
    .parse(options.providerInstanceRef)
  const createConnectionId = options.createConnectionId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const accountBinding = (
    principal: PrincipalSnapshot,
    targetProviderInstanceRef: string,
    connectionId: string
  ) => Object.freeze({
    principal,
    providerInstanceRef: targetProviderInstanceRef,
    connectionId
  })
  let operationTail = Promise.resolve()
  const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = operationTail
    let release!: () => void
    operationTail = new Promise<void>((resolve) => { release = resolve })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }

  const removeRetiredCredentials = async (
    principal: PrincipalSnapshot,
    targetProviderInstanceRef: string,
    credentialIds: readonly string[],
    assertPrincipalCurrent: () => void | Promise<void>
  ): Promise<readonly string[]> => {
    const remaining: string[] = []
    for (const connectionId of credentialIds) {
      await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
      try {
        await options.accounts.remove(accountBinding(
          principal,
          targetProviderInstanceRef,
          connectionId
        ))
      } catch {
        remaining.push(connectionId)
      }
      // The private vault binding includes the exact current Principal. A
      // switch during an idempotent remove must not target another namespace.
      await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    }
    return Object.freeze(remaining)
  }

  const retryPendingCredentialCleanup = async (
    principal: PrincipalSnapshot,
    assertPrincipalCurrent: () => void | Promise<void>
  ): Promise<void> => {
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    const snapshot = await readSettings(options.settings, providerInstanceRef)
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    const connection = findConnection(snapshot.connections, principal, providerInstanceRef)
    let connections = snapshot.connections
    let retiredConnections = snapshot.retiredConnections
    let changed = snapshot.needsMigration

    if (connection?.retiredCredentialIds?.length) {
      const remaining = await removeRetiredCredentials(
        principal,
        providerInstanceRef,
        connection.retiredCredentialIds,
        assertPrincipalCurrent
      )
      if (remaining.length !== connection.retiredCredentialIds.length) {
        changed = true
        connections = snapshot.connections.map((candidate) => candidate === connection
          ? withRetiredCredentialIds(candidate, remaining)
          : candidate)
      }
    }

    const nextRetiredConnections: RetiredConnectionRecord[] = []
    for (const retired of retiredConnections) {
      if (!samePrincipalOwner(retired.principal, principal)) {
        nextRetiredConnections.push(retired)
        continue
      }
      const remaining = await removeRetiredCredentials(
        principal,
        retired.providerInstanceRef,
        retired.credentialIds,
        assertPrincipalCurrent
      )
      if (remaining.length !== retired.credentialIds.length) changed = true
      if (remaining.length > 0) {
        nextRetiredConnections.push(retiredConnectionRecordSchema.parse({
          ...retired,
          credentialIds: remaining
        }))
      }
    }
    retiredConnections = Object.freeze(nextRetiredConnections)

    if (!changed) return
    const next = connectionSettingsSchema.parse({
      version: 2,
      connections,
      retiredConnections
    })
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    try {
      await options.settings.write(next, snapshot.revision)
    } catch {
      // Removed credentials remain listed and are retried idempotently if the
      // optimistic settings commit loses a race or storage is temporarily down.
      await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
      return
    }
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
  }

  const status = async (input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentConnectionStatus> => {
    requireConfiguredProviderInstance(input.providerInstanceRef, providerInstanceRef)
    const { client } = requireOpenContentDeploymentRuntime(options.getRuntime)
    await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
    await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
    await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
    const snapshot = await readSettings(options.settings, providerInstanceRef)
    await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
    const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
    if (!connection) return Object.freeze({ state: 'disconnected' })
    const credential = await options.accounts.status(accountBinding(
      input.principal,
      providerInstanceRef,
      connection.connectionId
    ))
    await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
    if (connection.state === 'reauthentication_required' || credential.state !== 'available') {
      if (connection.state !== 'reauthentication_required') {
        await markReauthenticationRequired(
          input.principal,
          connection.connectionId,
          input.assertPrincipalCurrent
        )
      }
      return connectionStatus(connection, 'reauthentication_required')
    }
    try {
      const valid = await options.accounts.withSession(
        accountBinding(input.principal, providerInstanceRef, connection.connectionId),
        async ({ token }) => {
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          const result = await client.isTokenValid({
            token,
            signal: input.signal,
            assertPrincipalCurrent: input.assertPrincipalCurrent
          })
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          return result
        }
      )
      if (valid) return connectionStatus(connection, 'connected')
    } catch (error) {
      const missingCredential = error instanceof OpenContentPrivateAccountError && (
        error.code === 'session_unavailable' ||
        error.code === 'binding_mismatch'
      )
      const invalidProviderSession = error instanceof OpenContentConnectorError &&
        error.code === 'reauthentication_required'
      if (!missingCredential && !invalidProviderSession) throw error
    }
    await markReauthenticationRequired(
      input.principal,
      connection.connectionId,
      input.assertPrincipalCurrent
    )
    return connectionStatus(connection, 'reauthentication_required')
  }

  const markReauthenticationRequired = (
    principal: PrincipalSnapshot,
    connectionId: string,
    assertPrincipalCurrent: () => void | Promise<void>
  ) => serialize(async () => {
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    const snapshot = await readSettings(options.settings, providerInstanceRef)
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    const connection = findConnection(snapshot.connections, principal, providerInstanceRef)
    if (!connection || connection.connectionId !== connectionId ||
      connection.state === 'reauthentication_required') return
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    await options.settings.write(connectionSettingsSchema.parse({
      version: 2,
      connections: snapshot.connections.map((candidate) => candidate === connection
        ? { ...candidate, state: 'reauthentication_required', updatedAt: now().toISOString() }
        : candidate),
      retiredConnections: snapshot.retiredConnections
    }), snapshot.revision)
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
  })

  const useCurrentSession: OpenContentConnectionService['useCurrentSession'] = async (
    input,
    operation
  ) => {
    requireConfiguredProviderInstance(input.providerInstanceRef, providerInstanceRef)
    const { client } = requireOpenContentDeploymentRuntime(options.getRuntime)
    let connectionId: string | undefined
    try {
      return await serialize(async () => {
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        const snapshot = await readSettings(options.settings, providerInstanceRef)
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
        if (!connection || connection.state !== 'connected') throw reauthenticationRequired()
        connectionId = connection.connectionId
        return options.accounts.withSession(accountBinding(
          input.principal,
          providerInstanceRef,
          connection.connectionId
        ), async ({ token }) => {
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
          if (!sameExternalAccount(connection.externalAccount, observedAccount)) {
            throw reauthenticationRequired()
          }
          const bindingAttestation = createExternalBindingAttestation({
            providerInstanceRef,
            principal: input.principal,
            connectionId: connection.connectionId,
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
        })
      })
    } catch (error) {
      const missingCredential = error instanceof OpenContentPrivateAccountError && (
        error.code === 'session_unavailable' ||
        error.code === 'binding_mismatch'
      )
      const invalidProviderSession = error instanceof OpenContentConnectorError &&
        error.code === 'reauthentication_required'
      if (!missingCredential && !invalidProviderSession) throw error
      if (connectionId !== undefined) {
        await markReauthenticationRequired(
          input.principal,
          connectionId,
          input.assertPrincipalCurrent
        )
      }
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
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        const snapshot = await readSettings(options.settings, providerInstanceRef)
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        const connection = findConnection(
          snapshot.connections,
          input.principal,
          providerInstanceRef
        )
        const retiredConnectionPending = snapshot.retiredConnections.some((retired) =>
          samePrincipalOwner(retired.principal, input.principal))
        if (!connection) {
          if (retiredConnectionPending) throw retiredCredentialCleanupFailed()
          return Object.freeze({
            state: 'disconnected' as const,
            remoteRevocation: 'unsupported' as const
          })
        }
        if (connection.retiredCredentialIds?.length || retiredConnectionPending) {
          throw retiredCredentialCleanupFailed()
        }
        await options.accounts.remove(accountBinding(
          input.principal,
          providerInstanceRef,
          connection.connectionId
        ))
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        const next = connectionSettingsSchema.parse({
          version: 2,
          connections: snapshot.connections.filter((candidate) => candidate !== connection),
          retiredConnections: snapshot.retiredConnections
        })
        await options.settings.write(next, snapshot.revision)
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        return Object.freeze({
          state: 'disconnected' as const,
          remoteRevocation: 'unsupported' as const
        })
      })
    },
    enroll: async (input) => {
      requireConfiguredProviderInstance(input.providerInstanceRef, providerInstanceRef)
      requireOpenContentDeploymentRuntime(options.getRuntime)
      return serialize(async () => {
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        const snapshot = await readSettings(options.settings, providerInstanceRef)
        await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
        const prior = findConnection(snapshot.connections, input.principal, providerInstanceRef)
        const connectionId = connectionIdSchema.parse(createConnectionId())
        assertConnectionIdAvailable(
          connectionId,
          input.principal,
          providerInstanceRef,
          snapshot.connections
        )
        const enrollment = await options.accounts.enroll({
          principal: input.principal,
          providerInstanceRef: input.providerInstanceRef,
          connectionId,
          signal: input.signal,
          assertPrincipalCurrent: input.assertPrincipalCurrent
        })
        const binding = accountBinding(input.principal, providerInstanceRef, connectionId)
        let nextConnection: ConnectionRecord
        try {
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          nextConnection = connectionRecordSchema.parse({
            principal: stablePrincipal(input.principal),
            providerInstanceRef,
            connectionId,
            ...(prior ? {
              retiredCredentialIds: appendRetiredCredentialId(
                prior.retiredCredentialIds ?? [],
                prior.connectionId
              )
            } : {}),
            externalAccount: {
              id: enrollment.externalAccount.id,
              identityId: enrollment.externalAccount.identityId,
              account: enrollment.externalAccount.account,
              name: enrollment.externalAccount.name
            },
            state: 'connected',
            updatedAt: now().toISOString()
          })
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          const next = connectionSettingsSchema.parse({
            version: 2,
            connections: [
              ...snapshot.connections.filter((connection) => !sameConnectionOwner(
                connection,
                input.principal,
                providerInstanceRef
              )),
              nextConnection
            ],
            retiredConnections: snapshot.retiredConnections
          })
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          await options.settings.write(next, snapshot.revision)
        } catch (error) {
          await options.accounts.remove(binding).catch(() => undefined)
          throw error
        }
        await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
        return connectionStatus(nextConnection, 'connected')
      })
    }
  })
}

async function readSettings(
  settings: DomainMainPackageSettingsHost,
  providerInstanceRef: string
): Promise<ConnectionSettingsSnapshot> {
  const snapshot = await settings.read()
  if (snapshot.value === null) {
    return Object.freeze({
      revision: snapshot.revision,
      connections: Object.freeze([]),
      retiredConnections: Object.freeze([]),
      needsMigration: false
    })
  }
  const current = connectionSettingsSchema.safeParse(snapshot.value)
  if (current.success) {
    if (current.data.connections.some((connection) =>
      connection.providerInstanceRef !== providerInstanceRef)) {
      throw invalidStoredProviderInstance()
    }
    return Object.freeze({
      revision: snapshot.revision,
      connections: Object.freeze(current.data.connections),
      retiredConnections: Object.freeze(current.data.retiredConnections),
      needsMigration: false
    })
  }

  const legacy = legacyConnectionSettingsSchema.parse(snapshot.value)
  const connections: ConnectionRecord[] = []
  const retiredConnections: RetiredConnectionRecord[] = []
  for (const connection of legacy.connections) {
    if (connection.providerInstanceRef === providerInstanceRef) {
      connections.push(connection)
      continue
    }
    const retiredProvider = legacyProviderInstanceRefSchema.safeParse(
      connection.providerInstanceRef
    )
    if (!retiredProvider.success) throw invalidStoredProviderInstance()
    mergeRetiredConnection(retiredConnections, {
      principal: connection.principal,
      providerInstanceRef: retiredProvider.data,
      credentialIds: uniqueCredentialIds([
        connection.connectionId,
        ...(connection.retiredCredentialIds ?? [])
      ])
    })
  }
  return Object.freeze({
    revision: snapshot.revision,
    connections: Object.freeze(connections),
    retiredConnections: Object.freeze(retiredConnections),
    needsMigration: true
  })
}

function findConnection(
  connections: readonly ConnectionRecord[],
  principal: PrincipalSnapshot,
  providerInstanceRef: string
): ConnectionRecord | undefined {
  return connections.find((connection) => sameConnectionOwner(
    connection,
    principal,
    providerInstanceRef
  ))
}

function sameConnectionOwner(
  connection: ConnectionRecord,
  principal: PrincipalSnapshot,
  providerInstanceRef: string
): boolean {
  return connection.providerInstanceRef === providerInstanceRef &&
    samePrincipalOwner(connection.principal, principal)
}

function samePrincipalOwner(
  stored: ConnectionRecord['principal'],
  principal: ConnectionRecord['principal']
): boolean {
  return stored.authority === principal.authority &&
    stored.subject === principal.subject &&
    stored.assurance === principal.assurance &&
    stored.deviceId === principal.deviceId
}

function mergeRetiredConnection(
  retiredConnections: RetiredConnectionRecord[],
  rawNext: RetiredConnectionRecord
): void {
  const next = retiredConnectionRecordSchema.parse(rawNext)
  const existingIndex = retiredConnections.findIndex((candidate) =>
    candidate.providerInstanceRef === next.providerInstanceRef &&
    samePrincipalOwner(candidate.principal, next.principal))
  if (existingIndex < 0) {
    retiredConnections.push(next)
    return
  }
  const existing = retiredConnections[existingIndex]!
  retiredConnections[existingIndex] = retiredConnectionRecordSchema.parse({
    ...existing,
    credentialIds: uniqueCredentialIds([...existing.credentialIds, ...next.credentialIds])
  })
}

function uniqueCredentialIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

function appendRetiredCredentialId(pending: readonly string[], next: string): readonly string[] {
  return pending.includes(next) ? pending : [...pending, next]
}

function withRetiredCredentialIds(
  connection: ConnectionRecord,
  retiredCredentialIds: readonly string[]
): ConnectionRecord {
  const { retiredCredentialIds: _retiredCredentialIds, ...active } = connection
  return connectionRecordSchema.parse({
    ...active,
    ...(retiredCredentialIds.length > 0 ? { retiredCredentialIds } : {})
  })
}

function assertConnectionIdAvailable(
  connectionId: string,
  principal: PrincipalSnapshot,
  providerInstanceRef: string,
  connections: readonly ConnectionRecord[]
): void {
  const activeCollision = connections.some((connection) =>
    connection.connectionId === connectionId &&
    sameConnectionOwner(connection, principal, providerInstanceRef))
  const cleanupCollision = connections.some((record) =>
    sameConnectionOwner(record, principal, providerInstanceRef) &&
    record.retiredCredentialIds?.includes(connectionId))
  if (activeCollision || cleanupCollision) {
    throw new OpenContentConnectorError(
      'provider_contract_violation',
      'OpenContent connection identity allocation failed.'
    )
  }
}

function stablePrincipal(principal: PrincipalSnapshot): ConnectionRecord['principal'] {
  return Object.freeze({
    authority: principal.authority,
    subject: principal.subject,
    assurance: principal.assurance,
    deviceId: principal.deviceId
  })
}

function sameExternalAccount(
  stored: ConnectionRecord['externalAccount'],
  observed: Readonly<{
    id: string
    identityId: number
    account: string
    name: string
  }>
): boolean {
  return stored.id === observed.id &&
    stored.identityId === observed.identityId
}

const EXTERNAL_SUBJECT_DIGEST_DOMAIN =
  'sciforge.opencontent.external-binding-subject.v1' as const
const BINDING_REVISION_DIGEST_DOMAIN =
  'sciforge.opencontent.external-binding-revision.v1' as const

function createExternalBindingAttestation(input: Readonly<{
  providerInstanceRef: string
  principal: PrincipalSnapshot
  connectionId: string
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
      input.connectionId,
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

function connectionStatus(
  connection: ConnectionRecord,
  state: 'connected' | 'reauthentication_required'
): OpenContentConnectionStatus {
  return Object.freeze(openContentConnectionStatusSchema.parse({
    state,
    providerInstanceRef: connection.providerInstanceRef,
    externalAccount: connection.externalAccount
  }))
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

function retiredCredentialCleanupFailed(): OpenContentPrivateAccountError {
  return new OpenContentPrivateAccountError(
    'secure_storage_unavailable',
    'Retired OpenContent credentials could not be removed from secure storage.'
  )
}

function invalidStoredProviderInstance(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'provider_contract_violation',
    'Stored OpenContent connection metadata names an unsupported Provider Instance.'
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
