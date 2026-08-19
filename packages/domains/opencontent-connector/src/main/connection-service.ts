import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  DomainMainProviderCredentialError,
  type DomainMainPackageSettingsHost,
  type DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import {
  principalAssuranceSchema,
  principalAuthoritySchema,
  principalSubjectSchema,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'

import {
  OpenContentConnectorError,
  openContentConnectionStatusSchema,
  type OpenContentConnectionStatus
} from '../contract.js'
import type { OpenContentClient } from './opencontent-client.js'

const storedPrincipalSchema = z.object({
  authority: principalAuthoritySchema,
  subject: principalSubjectSchema,
  assurance: principalAssuranceSchema,
  deviceId: z.string().trim().min(1).max(256)
}).strict()

const connectionIdSchema = z.string().trim().min(1).max(256)

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

const connectionSettingsSchema = z.object({
  version: z.literal(1),
  connections: z.array(connectionRecordSchema).max(256)
}).strict()

export type OpenContentConnectionService = Readonly<{
  bindExistingAccount(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    username: string
    password: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<OpenContentConnectionStatus>
  status(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<OpenContentConnectionStatus>
  useCurrentToken<T>(
    input: Readonly<{
      principal: PrincipalSnapshot
      providerInstanceRef: string
      assertPrincipalCurrent(): void
      signal?: AbortSignal
    }>,
    operation: (token: string) => T | Promise<T>
  ): Promise<T>
  unbind(input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    assertPrincipalCurrent(): void
  }>): Promise<Readonly<{
    state: 'disconnected'
    remoteRevocation: 'unsupported'
  }>>
}>

export function createOpenContentConnectionService(options: Readonly<{
  providerInstanceRef: string
  settings: DomainMainPackageSettingsHost
  credentials: DomainMainProviderCredentialStoreHost
  client: OpenContentClient
  createConnectionId?: () => string
  now?: () => Date
}>): OpenContentConnectionService {
  const providerInstanceRef = z.string().trim().min(3).max(256)
    .parse(options.providerInstanceRef)
  const createConnectionId = options.createConnectionId ?? randomUUID
  const now = options.now ?? (() => new Date())
  const credentialAccess = (connectionId: string) => Object.freeze({
    binding: Object.freeze({ providerInstanceRef, connectionId }),
    acceptedPrincipalAssurances: ['local-selection'] as const
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

  const retryPendingCredentialCleanup = async (principal: PrincipalSnapshot): Promise<void> => {
    const snapshot = await readSettings(options.settings)
    const connection = findConnection(snapshot.connections, principal, providerInstanceRef)
    if (!connection?.retiredCredentialIds?.length) return
    const remaining: string[] = []
    let removed = false
    for (const connectionId of connection.retiredCredentialIds) {
      try {
        await options.credentials.remove(credentialAccess(connectionId))
        removed = true
      } catch {
        remaining.push(connectionId)
      }
    }
    if (!removed) return
    await options.settings.write(connectionSettingsSchema.parse({
      version: 1,
      connections: snapshot.connections.map((candidate) => candidate === connection
        ? withRetiredCredentialIds(candidate, remaining)
        : candidate)
    }), snapshot.revision)
  }

  const status = async (input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<OpenContentConnectionStatus> => {
    requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
    input.assertPrincipalCurrent()
    await retryPendingCredentialCleanup(input.principal).catch(() => undefined)
    const snapshot = await readSettings(options.settings)
    const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
    if (!connection) return Object.freeze({ state: 'disconnected' })
    const credential = await options.credentials.status(credentialAccess(connection.connectionId))
    if (connection.state === 'reauthentication_required' || credential.state !== 'available') {
      if (connection.state !== 'reauthentication_required') {
        await markReauthenticationRequired(input.principal, connection.connectionId)
      }
      return connectionStatus(connection, 'reauthentication_required')
    }
    try {
      const valid = await options.credentials.use(
        credentialAccess(connection.connectionId),
        async (token) => {
          input.assertPrincipalCurrent()
          const result = await options.client.isTokenValid({ token, signal: input.signal })
          input.assertPrincipalCurrent()
          return result
        }
      )
      if (valid) return connectionStatus(connection, 'connected')
    } catch (error) {
      const missingCredential = error instanceof DomainMainProviderCredentialError && (
        error.code === 'credential_unavailable' ||
        error.code === 'credential_binding_mismatch'
      )
      const invalidProviderSession = error instanceof OpenContentConnectorError &&
        error.code === 'reauthentication_required'
      if (!missingCredential && !invalidProviderSession) throw error
    }
    await markReauthenticationRequired(input.principal, connection.connectionId)
    return connectionStatus(connection, 'reauthentication_required')
  }

  const markReauthenticationRequired = (
    principal: PrincipalSnapshot,
    connectionId: string
  ) => serialize(async () => {
    const snapshot = await readSettings(options.settings)
    const connection = findConnection(snapshot.connections, principal, providerInstanceRef)
    if (!connection || connection.connectionId !== connectionId ||
      connection.state === 'reauthentication_required') return
    await options.settings.write(connectionSettingsSchema.parse({
      version: 1,
      connections: snapshot.connections.map((candidate) => candidate === connection
        ? { ...candidate, state: 'reauthentication_required', updatedAt: now().toISOString() }
        : candidate)
    }), snapshot.revision)
  })

  const useCurrentToken: OpenContentConnectionService['useCurrentToken'] = async (
    input,
    operation
  ) => {
    requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
    input.assertPrincipalCurrent()
    const snapshot = await readSettings(options.settings)
    const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
    if (!connection || connection.state !== 'connected') throw reauthenticationRequired()
    return options.credentials.use(credentialAccess(connection.connectionId), async (token) => {
      input.assertPrincipalCurrent()
      const valid = await options.client.isTokenValid({ token, signal: input.signal })
      input.assertPrincipalCurrent()
      if (!valid) throw reauthenticationRequired()
      return operation(token)
    }).catch((error: unknown) => {
      const missingCredential = error instanceof DomainMainProviderCredentialError && (
        error.code === 'credential_unavailable' ||
        error.code === 'credential_binding_mismatch'
      )
      const invalidProviderSession = error instanceof OpenContentConnectorError &&
        error.code === 'reauthentication_required'
      if (!missingCredential && !invalidProviderSession) throw error
      return markReauthenticationRequired(input.principal, connection.connectionId)
        .then(() => { throw reauthenticationRequired() })
    })
  }

  return Object.freeze({
    status,
    useCurrentToken,
    unbind: (input) => serialize(async () => {
      requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
      input.assertPrincipalCurrent()
      await retryPendingCredentialCleanup(input.principal).catch(() => undefined)
      const snapshot = await readSettings(options.settings)
      const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
      if (!connection) {
        return Object.freeze({ state: 'disconnected' as const, remoteRevocation: 'unsupported' as const })
      }
      if (connection.retiredCredentialIds?.length) {
        throw new DomainMainProviderCredentialError(
          'secure_storage_unavailable',
          'Retired OpenContent credentials could not be removed from secure storage.'
        )
      }
      await options.credentials.remove(credentialAccess(connection.connectionId))
      input.assertPrincipalCurrent()
      const next = connectionSettingsSchema.parse({
        version: 1,
        connections: snapshot.connections.filter((candidate) => candidate !== connection)
      })
      await options.settings.write(next, snapshot.revision)
      return Object.freeze({
        state: 'disconnected' as const,
        remoteRevocation: 'unsupported' as const
      })
    }),
    bindExistingAccount: (input) => serialize(async () => {
      requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
      input.assertPrincipalCurrent()
      await retryPendingCredentialCleanup(input.principal).catch(() => undefined)
      const session = await options.client.authenticateExistingAccount({
        username: input.username,
        password: input.password,
        signal: input.signal
      })
      input.assertPrincipalCurrent()
      const connectionId = z.string().trim().min(1).max(256).parse(createConnectionId())
      const snapshot = await readSettings(options.settings)
      const prior = findConnection(snapshot.connections, input.principal, providerInstanceRef)
      assertConnectionIdAvailable(
        connectionId,
        input.principal,
        providerInstanceRef,
        snapshot.connections
      )
      const access = credentialAccess(connectionId)
      const nextConnection = connectionRecordSchema.parse({
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
          id: session.account.id,
          identityId: session.account.identityId,
          account: session.account.account,
          name: session.account.name
        },
        state: 'connected',
        updatedAt: now().toISOString()
      })
      await options.credentials.replace(access, session.token)
      try {
        const next = connectionSettingsSchema.parse({
          version: 1,
          connections: [
            ...snapshot.connections.filter((connection) => !sameConnectionOwner(
              connection,
              input.principal,
              providerInstanceRef
            )),
            nextConnection
          ]
        })
        input.assertPrincipalCurrent()
        await options.settings.write(next, snapshot.revision)
      } catch (error) {
        await options.credentials.remove(access).catch(() => undefined)
        throw error
      }
      await retryPendingCredentialCleanup(input.principal).catch(() => undefined)
      return connectionStatus(nextConnection, 'connected')
    })
  })
}

async function readSettings(settings: DomainMainPackageSettingsHost): Promise<Readonly<{
  revision: number
  connections: readonly ConnectionRecord[]
}>> {
  const snapshot = await settings.read()
  if (snapshot.value === null) {
    return Object.freeze({
      revision: snapshot.revision,
      connections: Object.freeze([])
    })
  }
  const parsed = connectionSettingsSchema.parse(snapshot.value)
  return Object.freeze({
    revision: snapshot.revision,
    connections: Object.freeze(parsed.connections)
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
    connection.principal.authority === principal.authority &&
    connection.principal.subject === principal.subject &&
    connection.principal.assurance === principal.assurance &&
    connection.principal.deviceId === principal.deviceId
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

function requireProviderInstanceRef(selected: string, expected: string): void {
  if (selected !== expected) {
    throw new OpenContentConnectorError(
      'invalid_input',
      'The selected OpenContent Provider Instance is not installed.'
    )
  }
}
