import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import type { z } from 'zod'

import {
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OpenContentConnectorError,
  openContentBindInputSchema,
  openContentConnectionTargetInputSchema,
  openContentConnectionResultSchema,
  openContentUnbindOutputSchema
} from '../contract.js'
import { OPENCONTENT_CONNECTOR_DOMAIN_MODULE_ID } from '../definition.js'
import type { OpenContentConnectionService } from './connection-service.js'
import { OpenContentPrivateAccountError } from './private-account-runtime.js'

type OpenContentCapabilityContext = Readonly<{
  caller: Readonly<{
    audience: 'ui' | 'agent' | 'system'
    principal?: PrincipalSnapshot
  }>
  signal?: AbortSignal
  assertPrincipalCurrent(): void
}>

type OpenContentCapabilityOptions = Readonly<{
  id: string
  version: string
  title: string
  description: string
  audiences: readonly ['ui']
  scope: 'global'
  effect: 'read' | 'external-write'
  approval: 'none'
  concurrency: Readonly<{ revision: 'none'; idempotency: 'none' | 'required' }>
  tags: readonly string[]
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler(
    input: any,
    context: OpenContentCapabilityContext
  ): Readonly<{ output: unknown; changed?: boolean }> |
    Promise<Readonly<{ output: unknown; changed?: boolean }>>
}>

export type OpenContentCapabilityFactoryContribution<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof OPENCONTENT_CONNECTOR_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'opencontent'
    title: 'OpenContent Connection'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions(): readonly CapabilityDefinition[]
}>

export function createOpenContentCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability(options: OpenContentCapabilityOptions): CapabilityDefinition
  providerInstanceRef: string
  connections: OpenContentConnectionService
}>): OpenContentCapabilityFactoryContribution<CapabilityDefinition> {
  const define = (
    input: Omit<OpenContentCapabilityOptions, 'audiences' | 'scope'>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    audiences: ['ui'],
    scope: 'global'
  })
  return Object.freeze({
    moduleId: OPENCONTENT_CONNECTOR_DOMAIN_MODULE_ID,
    policy: Object.freeze({
      id: 'opencontent' as const,
      title: 'OpenContent Connection' as const,
      directTransportPrefixes: Object.freeze([]) as readonly [],
      allowedDirectTransports: Object.freeze([]) as readonly []
    }),
    createDefinitions: () => [
      define({
        id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.status,
        version: '2.0.0',
        title: 'Inspect OpenContent Connection',
        description: 'Reads the current Principal connection status for OpenContent.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['opencontent', 'provider-connection'],
        inputSchema: openContentConnectionTargetInputSchema,
        outputSchema: openContentConnectionResultSchema,
        handler: async (input, context) => {
          const principal = requireConnectionPrincipal(context)
          const targetError = validateSelectedProviderInstance(
            input.providerInstanceRef,
            options.providerInstanceRef
          )
          if (targetError) return { output: targetError }
          return {
            output: await connectionCapabilityResult(() => options.connections.status({
              principal,
              providerInstanceRef: input.providerInstanceRef,
              signal: context.signal,
              assertPrincipalCurrent: context.assertPrincipalCurrent
            }))
          }
        }
      }),
      define({
        id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.bind,
        version: '2.0.0',
        title: 'Bind Existing OpenContent Account',
        description: 'Validates and binds one existing OpenContent account to the current Principal.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['opencontent', 'provider-connection', 'sensitive-input'],
        inputSchema: openContentBindInputSchema,
        outputSchema: openContentConnectionResultSchema,
        handler: async (input, context) => {
          const principal = requireConnectionPrincipal(context)
          const targetError = validateSelectedProviderInstance(
            input.providerInstanceRef,
            options.providerInstanceRef
          )
          if (targetError) return { output: targetError }
          const credentials = {
            account: input.account,
            password: input.password
          }
          try {
            return {
              output: await connectionCapabilityResult(() => options.connections.enroll({
                principal,
                providerInstanceRef: input.providerInstanceRef,
                credentials,
                signal: context.signal,
                assertPrincipalCurrent: context.assertPrincipalCurrent
              }))
            }
          } finally {
            credentials.account = ''
            credentials.password = ''
          }
        }
      }),
      define({
        id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind,
        version: '2.0.0',
        title: 'Unbind OpenContent Account',
        description: 'Removes this Principal-bound, node-local OpenContent Session Token.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['opencontent', 'provider-connection'],
        inputSchema: openContentConnectionTargetInputSchema,
        outputSchema: openContentUnbindOutputSchema,
        handler: async (input, context) => {
          const principal = requireConnectionPrincipal(context)
          const targetError = validateSelectedProviderInstance(
            input.providerInstanceRef,
            options.providerInstanceRef
          )
          if (targetError) return { output: targetError }
          return {
            output: await unbindCapabilityResult(() => options.connections.unbind({
              principal,
              providerInstanceRef: input.providerInstanceRef,
              signal: context.signal,
              assertPrincipalCurrent: context.assertPrincipalCurrent
            }))
          }
        }
      })
    ]
  })
}

function requireConnectionPrincipal(context: OpenContentCapabilityContext): PrincipalSnapshot {
  const principal = context.caller.principal
  if (
    context.caller.audience !== 'ui' ||
    principal === undefined ||
    (principal.assurance !== 'local-selection' &&
      principal.assurance !== 'cloud-authenticated')
  ) {
    throw new Error('A current UI Principal is required for OpenContent connection management.')
  }
  context.assertPrincipalCurrent()
  return principal
}

function validateSelectedProviderInstance(
  providerInstanceRef: string,
  installedProviderInstanceRef: string
) {
  if (providerInstanceRef === installedProviderInstanceRef) return undefined
  return Object.freeze({
    outcome: 'error' as const,
    error: Object.freeze({
      code: 'invalid_provider_instance' as const,
      action: 'select_provider' as const
    })
  })
}

async function connectionCapabilityResult(
  operation: () => Promise<import('../contract.js').OpenContentConnectionStatus>
) {
  try {
    return Object.freeze({
      outcome: 'success' as const,
      status: await operation()
    })
  } catch (error) {
    const publicError = toPublicEnrollmentError(error)
    if (!publicError) throw error
    return Object.freeze({ outcome: 'error' as const, error: publicError })
  }
}

async function unbindCapabilityResult(operation: () => Promise<Readonly<{
  state: 'disconnected'
  remoteRevocation: 'unsupported'
}>>) {
  try {
    return Object.freeze({ outcome: 'success' as const, ...await operation() })
  } catch (error) {
    const publicError = toPublicEnrollmentError(error)
    if (!publicError) throw error
    return Object.freeze({ outcome: 'error' as const, error: publicError })
  }
}

function toPublicEnrollmentError(error: unknown) {
  if (error instanceof OpenContentConnectorError) {
    const mapped = {
      unauthorized: { code: 'invalid_credentials', action: 'check_credentials' },
      reauthentication_required: { code: 'invalid_credentials', action: 'check_credentials' },
      provider_unavailable: { code: 'provider_unavailable', action: 'retry' },
      rate_limited: { code: 'rate_limited', action: 'retry_later' },
      provider_contract_violation: {
        code: 'provider_contract_violation',
        action: 'contact_support'
      },
      conflict: { code: 'enrollment_in_progress', action: 'retry' },
      cancelled: { code: 'cancelled', action: 'none' }
    } as const
    const result = error.code in mapped
      ? mapped[error.code as keyof typeof mapped]
      : undefined
    return result ? Object.freeze(result) : undefined
  }
  if (error instanceof OpenContentPrivateAccountError) {
    if (error.code === 'secure_storage_unavailable') {
      return Object.freeze({
        code: 'secure_storage_unavailable' as const,
        action: 'repair_secure_storage' as const
      })
    }
    if (error.code === 'cancelled') {
      return Object.freeze({
        code: 'cancelled' as const,
        action: 'none' as const
      })
    }
  }
  return undefined
}
