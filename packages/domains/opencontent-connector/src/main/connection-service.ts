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
  const credentialAccess = (targetProviderInstanceRef: string, connectionId: string) => Object.freeze({
    binding: Object.freeze({ providerInstanceRef: targetProviderInstanceRef, connectionId }),
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

  const removeRetiredCredentials = async (
    targetProviderInstanceRef: string,
    credentialIds: readonly string[],
    assertPrincipalCurrent: () => void
  ): Promise<readonly string[]> => {
    const remaining: string[] = []
    for (const connectionId of credentialIds) {
      assertPrincipalCurrent()
      try {
        await options.credentials.remove(credentialAccess(
          targetProviderInstanceRef,
          connectionId
        ))
      } catch {
        remaining.push(connectionId)
      }
      // The credential Host derives its namespace from the current Principal.
      // A switch during an idempotent remove can otherwise look like success in
      // the wrong namespace and make the original Token permanently untracked.
      assertPrincipalCurrent()
    }
    return Object.freeze(remaining)
  }

  const retryPendingCredentialCleanup = async (
    principal: PrincipalSnapshot,
    assertPrincipalCurrent: () => void
  ): Promise<void> => {
    assertPrincipalCurrent()
    const snapshot = await readSettings(options.settings, providerInstanceRef)
    assertPrincipalCurrent()
    const connection = findConnection(snapshot.connections, principal, providerInstanceRef)
    let connections = snapshot.connections
    let retiredConnections = snapshot.retiredConnections
    let changed = snapshot.needsMigration

    if (connection?.retiredCredentialIds?.length) {
      const remaining = await removeRetiredCredentials(
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
    assertPrincipalCurrent()
    try {
      await options.settings.write(next, snapshot.revision)
    } catch {
      // Removed credentials remain listed and are retried idempotently if the
      // optimistic settings commit loses a race or storage is temporarily down.
      assertPrincipalCurrent()
      return
    }
    assertPrincipalCurrent()
  }

  const status = async (input: Readonly<{
    principal: PrincipalSnapshot
    providerInstanceRef: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<OpenContentConnectionStatus> => {
    requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
    input.assertPrincipalCurrent()
    await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
    input.assertPrincipalCurrent()
    const snapshot = await readSettings(options.settings, providerInstanceRef)
    input.assertPrincipalCurrent()
    const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
    if (!connection) return Object.freeze({ state: 'disconnected' })
    const credential = await options.credentials.status(credentialAccess(
      providerInstanceRef,
      connection.connectionId
    ))
    input.assertPrincipalCurrent()
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
      const valid = await options.credentials.use(
        credentialAccess(providerInstanceRef, connection.connectionId),
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
    assertPrincipalCurrent: () => void
  ) => serialize(async () => {
    assertPrincipalCurrent()
    const snapshot = await readSettings(options.settings, providerInstanceRef)
    assertPrincipalCurrent()
    const connection = findConnection(snapshot.connections, principal, providerInstanceRef)
    if (!connection || connection.connectionId !== connectionId ||
      connection.state === 'reauthentication_required') return
    assertPrincipalCurrent()
    await options.settings.write(connectionSettingsSchema.parse({
      version: 2,
      connections: snapshot.connections.map((candidate) => candidate === connection
        ? { ...candidate, state: 'reauthentication_required', updatedAt: now().toISOString() }
        : candidate),
      retiredConnections: snapshot.retiredConnections
    }), snapshot.revision)
    assertPrincipalCurrent()
  })

  const useCurrentToken: OpenContentConnectionService['useCurrentToken'] = async (
    input,
    operation
  ) => {
    requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
    input.assertPrincipalCurrent()
    const snapshot = await readSettings(options.settings, providerInstanceRef)
    input.assertPrincipalCurrent()
    const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
    if (!connection || connection.state !== 'connected') throw reauthenticationRequired()
    return options.credentials.use(credentialAccess(
      providerInstanceRef,
      connection.connectionId
    ), async (token) => {
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
      input.assertPrincipalCurrent()
      return markReauthenticationRequired(
        input.principal,
        connection.connectionId,
        input.assertPrincipalCurrent
      )
        .then(() => { throw reauthenticationRequired() })
    })
  }

  return Object.freeze({
    status,
    useCurrentToken,
    unbind: (input) => serialize(async () => {
      requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
      input.assertPrincipalCurrent()
      await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
      input.assertPrincipalCurrent()
      const snapshot = await readSettings(options.settings, providerInstanceRef)
      input.assertPrincipalCurrent()
      const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
      const retiredConnectionPending = snapshot.retiredConnections.some((retired) =>
        samePrincipalOwner(retired.principal, input.principal))
      if (!connection) {
        if (retiredConnectionPending) throw retiredCredentialCleanupFailed()
        return Object.freeze({ state: 'disconnected' as const, remoteRevocation: 'unsupported' as const })
      }
      if (connection.retiredCredentialIds?.length || retiredConnectionPending) {
        throw retiredCredentialCleanupFailed()
      }
      await options.credentials.remove(credentialAccess(
        providerInstanceRef,
        connection.connectionId
      ))
      input.assertPrincipalCurrent()
      const next = connectionSettingsSchema.parse({
        version: 2,
        connections: snapshot.connections.filter((candidate) => candidate !== connection),
        retiredConnections: snapshot.retiredConnections
      })
      await options.settings.write(next, snapshot.revision)
      input.assertPrincipalCurrent()
      return Object.freeze({
        state: 'disconnected' as const,
        remoteRevocation: 'unsupported' as const
      })
    }),
    bindExistingAccount: (input) => serialize(async () => {
      requireProviderInstanceRef(input.providerInstanceRef, providerInstanceRef)
      input.assertPrincipalCurrent()
      await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
      const session = await options.client.authenticateExistingAccount({
        username: input.username,
        password: input.password,
        signal: input.signal
      })
      input.assertPrincipalCurrent()
      const connectionId = z.string().trim().min(1).max(256).parse(createConnectionId())
      const snapshot = await readSettings(options.settings, providerInstanceRef)
      input.assertPrincipalCurrent()
      const prior = findConnection(snapshot.connections, input.principal, providerInstanceRef)
      assertConnectionIdAvailable(
        connectionId,
        input.principal,
        providerInstanceRef,
        snapshot.connections
      )
      const access = credentialAccess(providerInstanceRef, connectionId)
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
      input.assertPrincipalCurrent()
      try {
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
        input.assertPrincipalCurrent()
        await options.settings.write(next, snapshot.revision)
      } catch (error) {
        await options.credentials.remove(access).catch(() => undefined)
        throw error
      }
      await retryPendingCredentialCleanup(input.principal, input.assertPrincipalCurrent)
      return connectionStatus(nextConnection, 'connected')
    })
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

function retiredCredentialCleanupFailed(): DomainMainProviderCredentialError {
  return new DomainMainProviderCredentialError(
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

function requireProviderInstanceRef(selected: string, expected: string): void {
  if (selected !== expected) {
    throw new OpenContentConnectorError(
      'invalid_input',
      'The selected OpenContent Provider Instance is not installed.'
    )
  }
}
