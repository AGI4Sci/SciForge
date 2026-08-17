import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import { defineDomainMainInternalServiceDescriptor } from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import type { z } from 'zod'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'

import {
  OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  OPENCONTENT_CONNECTION_CAPABILITY_IDS,
  OPENCONTENT_DEMO_INSTANCE_REF,
  OPENCONTENT_PROVIDER_KIND,
  openContentBindInputSchema,
  openContentConnectionStatusSchema,
  openContentEmptyInputSchema,
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
  createOpenContentConnectionService,
  type OpenContentConnectionService
} from './connection-service.js'
import { createOpenContentClient } from './opencontent-client.js'

const OPENCONTENT_DEVELOPMENT_BASE_URL = 'https://test1.edoc2.com'
const OPENCONTENT_ADAPTER_MODULE_ID = 'sciforge.opencontent-content-space-provider'

const internalServiceDescriptor = defineDomainMainInternalServiceDescriptor({
  location: 'main.internal-service-descriptor',
  serviceId: OPENCONTENT_CONTENT_SPACE_SERVICE_ID,
  contractVersion: OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION,
  allowedConsumerModuleIds: [OPENCONTENT_ADAPTER_MODULE_ID]
})

const instance = defineProviderInstanceDirectoryEntry({
  contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
  providerInstanceRef: OPENCONTENT_DEMO_INSTANCE_REF,
  providerKind: OPENCONTENT_PROVIDER_KIND,
  displayName: 'OpenContent (development)'
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
  host: DomainMainHost
): TrustedDomainProcessEntryInput<OpenContentMainContribution> {
  if (!host.packageSettings || !host.packageSecrets?.providerCredentials) {
    throw new Error('OpenContent Connector requires secure owner-scoped package storage.')
  }
  if (!host.internalServices) {
    throw new Error('OpenContent Connector requires Host internal-service mediation.')
  }
  const client = createOpenContentClient({
    baseUrl: OPENCONTENT_DEVELOPMENT_BASE_URL
  })
  const connections = createOpenContentConnectionService({
    providerInstanceRef: OPENCONTENT_DEMO_INSTANCE_REF,
    settings: host.packageSettings,
    credentials: host.packageSecrets.providerCredentials,
    client
  })
  const facade: OpenContentContentSpaceFacade = Object.freeze({
    listRootFolders: (input) => connections.useCurrentToken({
      principal: input.principal,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => client.listRootFolders({
      token,
      teamPage: input.teamPage,
      teamPageSize: input.teamPageSize,
      includePersonal: input.includePersonal,
      includeTeams: input.includeTeams,
      signal: input.signal
    })),
    listFolderEntries: (input) => connections.useCurrentToken({
      principal: input.principal,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => client.listFolderEntries({
      token,
      parentFolderGuid: input.parentFolderGuid,
      page: input.page,
      pageSize: input.pageSize,
      signal: input.signal
    })),
    observeEntry: (input) => connections.useCurrentToken({
      principal: input.principal,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => client.observeEntry({
      token,
      kind: input.kind,
      resourceGuid: input.resourceGuid,
      signal: input.signal
    })),
    createFolder: (input) => connections.useCurrentToken({
      principal: input.principal,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => client.createFolder({
      token,
      parentFolderGuid: input.parentFolderGuid,
      name: input.name,
      signal: input.signal
    })),
    uploadNewFile: (input) => connections.useCurrentToken({
      principal: input.principal,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => client.uploadNewFile({
      token,
      parentFolderGuid: input.parentFolderGuid,
      name: input.name,
      size: input.size,
      read: input.read,
      signal: input.signal
    })),
    downloadFile: (input) => connections.useCurrentToken({
      principal: input.principal,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, (token) => client.downloadFile({
      token,
      fileGuid: input.fileGuid,
      write: input.write,
      signal: input.signal
    }))
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
        inputSchema: openContentEmptyInputSchema,
        outputSchema: openContentConnectionStatusSchema,
        handler: async (_input, context) => ({
          output: await options.connections.status(requireLocalAccount(context))
        })
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
        outputSchema: openContentConnectionStatusSchema,
        handler: async (input, context) => ({
          output: await options.connections.bindExistingAccount({
            principal: requireLocalAccount(context),
            username: input.username,
            password: input.password,
            signal: context.signal,
            assertPrincipalCurrent: context.assertPrincipalCurrent
          })
        })
      }),
      define({
        id: OPENCONTENT_CONNECTION_CAPABILITY_IDS.unbind,
        title: 'Unbind OpenContent Account',
        description: 'Removes this node-local OpenContent credential and connection metadata.',
        effect: 'external-write',
        approval: 'none',
        concurrency: { revision: 'none', idempotency: 'required' },
        tags: ['opencontent', 'provider-connection'],
        inputSchema: openContentEmptyInputSchema,
        outputSchema: openContentUnbindOutputSchema,
        handler: async (_input, context) => ({
          output: await options.connections.unbind({
            principal: requireLocalAccount(context),
            assertPrincipalCurrent: context.assertPrincipalCurrent
          })
        })
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
