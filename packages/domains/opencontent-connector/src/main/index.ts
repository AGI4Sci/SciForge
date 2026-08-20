import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { defineDomainMainInternalServiceDescriptor } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import { DomainMainProviderCredentialError } from '@sciforge/domain-sdk/package-storage'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import type { z } from 'zod'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import {
  assertOpenContentSkillBundledAssetsPresent,
  type OpenContentSkillBundledAssetLocation
} from '@sciforge/opencontent-skill-runtime/main/bundled-assets'
import type {
  OpenContentCliProcessPort
} from '@sciforge/opencontent-skill-runtime/main/cli-runner'
import {
  createNodeOpenContentCliProcessPort
} from '@sciforge/opencontent-skill-runtime/main/node-cli-process-port'

import {
  OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OPENCONTENT_PROVIDER_KIND,
  OpenContentConnectorError,
  openContentBindInputSchema,
  openContentConnectionTargetInputSchema,
  openContentConnectionResultSchema,
  openContentConnectionStatusSchema,
  openContentUnbindOutputSchema,
  type OpenContentContentSpaceFacade
} from '../contract.js'
import {
  OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION,
  OPENCONTENT_CONNECTOR_DOMAIN_MODULE_ID,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT,
  OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION,
  OPENCONTENT_PROVIDER_INSTANCE_CONTRACT,
  OPENCONTENT_PROVIDER_INSTANCE_CONTRIBUTION,
  domainPackageDefinition
} from '../definition.js'
import {
  assertOpenContentPrincipalCurrent,
  createOpenContentConnectionService,
  type OpenContentConnectionService
} from './connection-service.js'
import { createOpenContentClient, type OpenContentClient } from './opencontent-client.js'
import {
  bindOpenContentTeamAdministration,
  createOpenContentTeamAdministration
} from './team-administration.js'
import {
  openContentIdentityIdSchema,
  type OpenContentTeamAdministration
} from '../team-administration-contract.js'
import {
  createOpenContentSkillRuntimeSession,
  resolveOpenContentSkillRuntimeAssets,
  type OpenContentSkillRuntimeSession
} from './skill-runtime.js'

const OPENCONTENT_ADAPTER_MODULE_ID = 'sciforge.opencontent-content-space-provider'

export const OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE = Object.freeze({
  id: 'edoc2-test1-verification' as const,
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  displayName: 'OpenContent' as const,
  origin: 'https://test1.edoc2.com' as const
})

const internalServiceDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  allowedConsumerModuleIds: [OPENCONTENT_ADAPTER_MODULE_ID]
})

const instance = defineProviderInstanceDirectoryEntry({
  contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
  providerInstanceRef: OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE.providerInstanceRef,
  providerKind: OPENCONTENT_PROVIDER_KIND,
  displayName: OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE.displayName
})

type OpenContentCapabilityContext = Readonly<{
  caller: Readonly<{
    audience: 'ui' | 'agent' | 'system'
    principal?: PrincipalSnapshot
  }>
  signal?: AbortSignal
  assertPrincipalCurrent(): void
}>

export type OpenContentCapabilityOptions = Readonly<{
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

export type OpenContentCapabilityFactory<CapabilityDefinition = unknown> = Readonly<{
  moduleId: typeof OPENCONTENT_CONNECTOR_DOMAIN_MODULE_ID
  policy: Readonly<{
    id: 'opencontent'
    title: 'OpenContent Connection'
    directTransportPrefixes: readonly []
    allowedDirectTransports: readonly []
  }>
  createDefinitions(): readonly CapabilityDefinition[]
}>

type OpenContentMainContribution =
  | typeof instance
  | typeof internalServiceDescriptor
  | OpenContentCapabilityFactory

export function createDomainMainEntry(
  host: DomainMainHost,
  options: Readonly<{
    fetch?: typeof fetch
    skillRuntime?: Readonly<{
      assets?: OpenContentSkillBundledAssetLocation
      processPort?: OpenContentCliProcessPort
      executablePath?: string
      temporaryRoot?: string
    }>
  }> = {}
): TrustedDomainProcessEntryInput<OpenContentMainContribution> {
  if (!host.packageSettings || !host.packageSecrets?.providerCredentials) {
    throw new Error('OpenContent Connector requires secure owner-scoped package storage.')
  }
  if (!host.internalServices) {
    throw new Error('OpenContent Connector requires Host internal-service mediation.')
  }
  const client = createOpenContentClient({
    baseUrl: OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE.origin,
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
  const connections = createOpenContentConnectionService({
    providerInstanceRef: OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE.providerInstanceRef,
    settings: host.packageSettings,
    credentials: host.packageSecrets.providerCredentials,
    client
  })
  const teamAdministration = createOpenContentTeamAdministration({
    baseUrl: OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE.origin,
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
  const skillAssets = resolveOpenContentSkillRuntimeAssets(
    host,
    options.skillRuntime?.assets
  )
  const skillAssetPaths = skillAssets === undefined
    ? undefined
    : assertOpenContentSkillBundledAssetsPresent(skillAssets)
  const skillRuntime = skillAssets === undefined || skillAssetPaths === undefined
    ? undefined
    : createOpenContentSkillRuntimeSession({
        connections,
        processPort: options.skillRuntime?.processPort ??
          createNodeOpenContentCliProcessPort({
            trustedEntrypoint: skillAssetPaths.cliEntrypoint,
            executablePath: options.skillRuntime?.executablePath ??
              host.getExecutablePath?.() ??
              process.execPath,
            electronRunAsNode: true,
            ...(options.skillRuntime?.temporaryRoot === undefined
              ? {}
              : { temporaryRoot: options.skillRuntime.temporaryRoot })
          }),
        assets: skillAssets,
        site: OPENCONTENT_EDOC2_TEST1_VERIFICATION_PROFILE.origin
      })
  const facade = createOpenContentContentSpaceFacade({
    client,
    connections,
    teamAdministration,
    ...(skillRuntime ? { skillRuntime } : {})
  })
  host.internalServices.register({
    serviceId: OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
    contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
    allowedConsumerModuleIds: [OPENCONTENT_ADAPTER_MODULE_ID],
    service: facade
  })
  return {
    definition: domainPackageDefinition,
    contributions: [
      {
        ...OPENCONTENT_CAPABILITY_FACTORY_CONTRIBUTION,
        value: createOpenContentCapabilityFactory({
          defineCapability: host.defineCapability as (
            options: OpenContentCapabilityOptions
          ) => unknown,
          connections
        })
      },
      {
        ...OPENCONTENT_PROVIDER_INSTANCE_CONTRIBUTION,
        contract: OPENCONTENT_PROVIDER_INSTANCE_CONTRACT,
        value: instance
      },
      {
        ...OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRIBUTION,
        contract: OPENCONTENT_INTERNAL_SERVICE_DESCRIPTOR_CONTRACT,
        value: internalServiceDescriptor
      }
    ]
  }
}

export function createOpenContentContentSpaceFacade(options: Readonly<{
  client: OpenContentClient
  connections: OpenContentConnectionService
  teamAdministration: OpenContentTeamAdministration
  skillRuntime?: OpenContentSkillRuntimeSession
}>): OpenContentContentSpaceFacade {
  return Object.freeze({
    ...(options.skillRuntime
      ? { useSkillRuntime: options.skillRuntime.useSkillRuntime }
      : {}),
    useTeamAdministration: (input, operation) => {
      const assertPrincipalCurrent = () =>
        assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
      return options.connections.useCurrentSession({
        principal: input.principal,
        providerInstanceRef: input.providerInstanceRef,
        assertPrincipalCurrent,
        signal: input.signal
      }, async ({ token, externalIdentityId: rawExternalIdentityId }) => {
        const externalIdentityId = openContentIdentityIdSchema.safeParse(rawExternalIdentityId)
        if (!externalIdentityId.success) {
          throw new OpenContentConnectorError(
            'provider_contract_violation',
            'The verified OpenContent identity is invalid.'
          )
        }
        let active = true
        const assertSessionCurrent = async (): Promise<void> => {
          if (!active) {
            throw new OpenContentConnectorError(
              'unauthorized',
              'The verified OpenContent Team administration session has expired.'
            )
          }
          await assertPrincipalCurrent()
        }
        const administration = bindOpenContentTeamAdministration(
          options.teamAdministration,
          token,
          assertSessionCurrent
        )
        try {
          return await operation(Object.freeze({
            externalIdentityId: externalIdentityId.data,
            administration
          }))
        } finally {
          active = false
        }
      })
    },
    listRootFolders: (input) => options.connections.useCurrentToken({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => options.client.listRootFolders({
      token,
      teamPage: input.teamPage,
      teamPageSize: input.teamPageSize,
      includePersonal: input.includePersonal,
      includeTeams: input.includeTeams,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    listFolderEntries: (input) => options.connections.useCurrentToken({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => options.client.listFolderEntries({
      token,
      parentFolderGuid: input.parentFolderGuid,
      page: input.page,
      pageSize: input.pageSize,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    observeEntry: (input) => options.connections.useCurrentToken({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => options.client.observeEntry({
      token,
      kind: input.kind,
      resourceGuid: input.resourceGuid,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    createFolder: (input) => options.connections.useCurrentToken({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => options.client.createFolder({
      token,
      parentFolderGuid: input.parentFolderGuid,
      name: input.name,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    uploadNewFile: (input) => options.connections.useCurrentToken({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => options.client.uploadNewFile({
      token,
      parentFolderGuid: input.parentFolderGuid,
      name: input.name,
      size: input.size,
      read: input.read,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    downloadFile: (input) => options.connections.useCurrentToken({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => options.client.downloadFile({
      token,
      fileGuid: input.fileGuid,
      write: input.write,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    }))
  })
}

export function createOpenContentCapabilityFactory<CapabilityDefinition>(options: Readonly<{
  defineCapability(options: OpenContentCapabilityOptions): CapabilityDefinition
  connections: OpenContentConnectionService
}>): OpenContentCapabilityFactory<CapabilityDefinition> {
  const define = (
    input: Omit<OpenContentCapabilityOptions, 'version' | 'audiences' | 'scope'>
  ): CapabilityDefinition => options.defineCapability({
    ...input,
    version: '1.0.0',
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
        title: 'Inspect OpenContent Connection',
        description: 'Reads the current Local Account connection status for OpenContent.',
        effect: 'read',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'none' },
        tags: ['opencontent', 'provider-connection'],
        inputSchema: openContentConnectionTargetInputSchema,
        outputSchema: openContentConnectionResultSchema,
        handler: async (input, context) => {
          const principal = requireLocalAccount(context)
          const targetError = validateSelectedProviderInstance(input.providerInstanceRef)
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
        title: 'Bind Existing OpenContent Account',
        description: 'Validates and binds one existing OpenContent account to the current Local Account.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['opencontent', 'provider-connection', 'sensitive-input'],
        inputSchema: openContentBindInputSchema,
        outputSchema: openContentConnectionResultSchema,
        handler: async (input, context) => {
          const principal = requireLocalAccount(context)
          const targetError = validateSelectedProviderInstance(input.providerInstanceRef)
          if (targetError) return { output: targetError }
          return {
            output: await connectionCapabilityResult(() => options.connections.bindExistingAccount({
              principal,
              providerInstanceRef: input.providerInstanceRef,
              username: input.username,
              password: input.password,
              signal: context.signal,
              assertPrincipalCurrent: context.assertPrincipalCurrent
            }))
          }
        }
      }),
      define({
        id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind,
        title: 'Unbind OpenContent Account',
        description: 'Removes this node-local OpenContent credential and connection metadata.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['opencontent', 'provider-connection'],
        inputSchema: openContentConnectionTargetInputSchema,
        outputSchema: openContentUnbindOutputSchema,
        handler: async (input, context) => {
          const principal = requireLocalAccount(context)
          const targetError = validateSelectedProviderInstance(input.providerInstanceRef)
          if (targetError) return { output: targetError }
          return {
            output: await unbindCapabilityResult(() => options.connections.unbind({
              principal,
              providerInstanceRef: input.providerInstanceRef,
              assertPrincipalCurrent: context.assertPrincipalCurrent
            }))
          }
        }
      })
    ]
  })
}

function requireLocalAccount(context: OpenContentCapabilityContext): PrincipalSnapshot {
  if (context.caller.audience !== 'ui' || context.caller.principal?.assurance !== 'local-selection') {
    throw new Error('A current Local Account is required for OpenContent connection management.')
  }
  context.assertPrincipalCurrent()
  return context.caller.principal
}

function validateSelectedProviderInstance(providerInstanceRef: string) {
  if (providerInstanceRef === OPENCONTENT_PROVIDER_INSTANCE_REF) return undefined
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
      cancelled: { code: 'cancelled', action: 'none' }
    } as const
    const result = error.code in mapped
      ? mapped[error.code as keyof typeof mapped]
      : undefined
    return result ? Object.freeze(result) : undefined
  }
  if (error instanceof DomainMainProviderCredentialError &&
    error.code.startsWith('secure_storage_')) {
    return Object.freeze({
      code: 'secure_storage_unavailable' as const,
      action: 'repair_secure_storage' as const
    })
  }
  return undefined
}
