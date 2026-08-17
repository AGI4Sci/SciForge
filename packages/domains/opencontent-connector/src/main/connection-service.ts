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

const connectionRecordSchema = z.object({
  principal: z.object({
    authority: principalAuthoritySchema,
    subject: principalSubjectSchema,
    assurance: principalAssuranceSchema,
    deviceId: z.string().trim().min(1).max(256)
  }).strict(),
  providerInstanceRef: z.string().trim().min(3).max(256),
  connectionId: z.string().trim().min(1).max(256),
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
    username: string
    password: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<OpenContentConnectionStatus>
  status(principal: PrincipalSnapshot): Promise<OpenContentConnectionStatus>
  useCurrentToken<T>(
    input: Readonly<{
      principal: PrincipalSnapshot
      assertPrincipalCurrent(): void
      signal?: AbortSignal
    }>,
    operation: (token: string) => T | Promise<T>
  ): Promise<T>
  unbind(input: Readonly<{
    principal: PrincipalSnapshot
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

  const status = async (principal: PrincipalSnapshot): Promise<OpenContentConnectionStatus> => {
    const snapshot = await readSettings(options.settings)
    const connection = findConnection(snapshot.connections, principal, providerInstanceRef)
    if (!connection) return Object.freeze({ state: 'disconnected' })
    const binding = { providerInstanceRef, connectionId: connection.connectionId }
    const hasCredential = await options.credentials.has(binding)
    return Object.freeze(openContentConnectionStatusSchema.parse({
      state: hasCredential ? connection.state : 'reauthentication_required',
      providerInstanceRef,
      externalAccount: connection.externalAccount
    }))
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

  return Object.freeze({
    status,
    useCurrentToken: async (input, operation) => {
      input.assertPrincipalCurrent()
      const snapshot = await readSettings(options.settings)
      const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
      if (!connection || connection.state !== 'connected') throw reauthenticationRequired()
      return options.credentials.use({
        providerInstanceRef,
        connectionId: connection.connectionId
      }, async (token) => {
        input.assertPrincipalCurrent()
        const valid = await options.client.isTokenValid({ token, signal: input.signal })
        input.assertPrincipalCurrent()
        if (!valid) throw reauthenticationRequired()
        return operation(token)
      }).catch((error: unknown) => {
        if (
          !(error instanceof DomainMainProviderCredentialError) &&
          !(error instanceof OpenContentConnectorError &&
            error.code === 'reauthentication_required')
        ) throw error
        return markReauthenticationRequired(input.principal, connection.connectionId)
          .then(() => { throw reauthenticationRequired() })
      })
    },
    unbind: (input) => serialize(async () => {
      input.assertPrincipalCurrent()
      const snapshot = await readSettings(options.settings)
      const connection = findConnection(snapshot.connections, input.principal, providerInstanceRef)
      if (!connection) {
        return Object.freeze({ state: 'disconnected' as const, remoteRevocation: 'unsupported' as const })
      }
      await options.credentials.remove({
        providerInstanceRef,
        connectionId: connection.connectionId
      })
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
      input.assertPrincipalCurrent()
      const session = await options.client.authenticateExistingAccount({
        username: input.username,
        password: input.password,
        signal: input.signal
      })
      input.assertPrincipalCurrent()
      const connectionId = z.string().trim().min(1).max(256).parse(createConnectionId())
      const binding = Object.freeze({ providerInstanceRef, connectionId })
      await options.credentials.write(binding, session.token)
      let prior: ConnectionRecord | undefined
      try {
        const snapshot = await readSettings(options.settings)
        prior = findConnection(snapshot.connections, input.principal, providerInstanceRef)
        const next = connectionSettingsSchema.parse({
          version: 1,
          connections: [
            ...snapshot.connections.filter((connection) => !sameConnectionOwner(
              connection,
              input.principal,
              providerInstanceRef
            )),
            {
              principal: stablePrincipal(input.principal),
              providerInstanceRef,
              connectionId,
              externalAccount: {
                id: session.account.id,
                identityId: session.account.identityId,
                account: session.account.account,
                name: session.account.name
              },
              state: 'connected',
              updatedAt: now().toISOString()
            }
          ]
        })
        input.assertPrincipalCurrent()
        await options.settings.write(next, snapshot.revision)
      } catch (error) {
        await options.credentials.remove(binding).catch(() => undefined)
        throw error
      }
      if (prior) {
        await options.credentials.remove({
          providerInstanceRef,
          connectionId: prior.connectionId
        })
      }
      return status(input.principal)
    })
  })
}

async function readSettings(settings: DomainMainPackageSettingsHost): Promise<Readonly<{
  revision: number
  connections: readonly ConnectionRecord[]
}>> {
  const snapshot = await settings.read()
  if (snapshot.value === null) {
    return Object.freeze({ revision: snapshot.revision, connections: Object.freeze([]) })
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

function stablePrincipal(principal: PrincipalSnapshot): ConnectionRecord['principal'] {
  return Object.freeze({
    authority: principal.authority,
    subject: principal.subject,
    assurance: principal.assurance,
    deviceId: principal.deviceId
  })
}

function reauthenticationRequired(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'reauthentication_required',
    'The OpenContent connection must be authenticated again.'
  )
}
