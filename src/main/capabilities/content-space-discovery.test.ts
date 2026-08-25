import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  canonicalizeDomainMainFiniteCapabilityBatchPlan,
  domainMainFiniteCapabilityBatchPlanDigestSchema,
  domainMainFiniteCapabilityBatchPlanSchema,
  type DomainMainHost
} from '@sciforge/domain-sdk/host'
import type { TrustedDomainProcessEntryInput } from '@sciforge/domain-sdk/main'
import { samePrincipalSnapshot, type PrincipalSnapshot } from '@sciforge/domain-sdk/principal'
import {
  MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION,
  defineContentSpaceProviderFactory,
  type ContentSpaceProviderFactoryRuntimeValue
} from '@sciforge/domain-sdk/provider-composition'
import {
  CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
  CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT,
  CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT,
  CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT,
  CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT,
  CONTENT_SPACE_ADMINISTRATION_OPERATIONS,
  defineContentSpaceAdministrationPort
} from '@sciforge/domain-content-space/administration-contract'
import {
  CONTENT_SPACE_CAPABILITY_IDS,
  CONTENT_SPACE_DOMAIN_MODULE_ID,
  CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
  defineContentSpaceProvider,
  toPortableContentContainerReference,
  type ContentSpaceProvider
} from '@sciforge/domain-content-space/contract'
import { NATIVE_DOCUMENT_OPERATIONS } from
  '@sciforge/domain-content-space/native-document-contract'
import type {
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor
} from
  '@sciforge/domain-content-space/provider-features'
import { LOCAL_MOCK_PROVIDER_INSTANCE_REF } from
  '@sciforge/domain-content-space-mock-provider/definition'
import { createDomainMainEntry as createMockProviderMainEntry } from
  '@sciforge/domain-content-space-mock-provider/main'

import { CapabilityBroker } from './broker'
import { defineCapability } from './registry'
import {
  CAPABILITY_AGENT_TOOL_NAMES,
  createCapabilityAgentToolSurface
} from './agent-tools'
import { HostFileTransferService } from '../modules/file-transfer'
import type { AppCapabilityDependencies } from './app-registry'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from '../modules/application-composition'
import { createNonSecretPackageStorageForTest } from
  '../modules/domain-package-storage.test-helper'
import {
  activateMainRuntimeContributions,
  createMainSystemCapabilityInvokerFactory
} from '../modules/runtime-contributions'

const principal: PrincipalSnapshot = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: '123e4567-e89b-42d3-a456-426614174000',
  assurance: 'local-selection',
  deviceId: 'content-space-broker-integration-device',
  identityVersion: 1
})

describe('Content Space Agent discovery integration', () => {
  it('routes one external Team library intent through Provider, candidate, and root authorization discovery', () => {
    const catalog = createTestApplicationCatalog(
      join(tmpdir(), 'sciforge-content-space-discovery')
    )
    try {
      const registry = createApplicationCapabilityRegistry(
        catalog,
        unavailableDependencies()
      )
      const caller = {
        audience: 'agent' as const,
        callerId: 'content-space-discovery-agent',
        workspaceId: '/workspace'
      }
      const query = {
        text: 'OpenContent team library create folder upload',
        scope: 'global' as const,
        limit: 10
      }

      const discovered = registry.discover(caller, query)
      expect(discovered.map(({ id }) => id)).toEqual(expect.arrayContaining([
        CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances,
        CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates,
        CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
      ]))
      expect(discovered.find(({ id }) =>
        id === CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
      )?.description).toMatch(/first.*provider instance/iu)
      expect(discovered.find(({ id }) =>
        id === CONTENT_SPACE_CAPABILITY_IDS.listAgentRootCandidates
      )?.description).toMatch(/after.*provider instance.*human-visible/iu)
      expect(discovered.find(({ id }) =>
        id === CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot
      )?.description).toMatch(/exact.*label.*re-enumerates live/iu)
      expect(registry.discover(caller, { ...query, providerFamily: 'managed-mcp' }))
        .toEqual([])

      const verboseNativeProviderDiscovery = registry.discover(caller, {
        text: 'OpenContent Provider Instance list discover native',
        scope: 'global',
        providerFamily: 'native',
        effects: ['read'],
        limit: 20
      })
      expect(verboseNativeProviderDiscovery.map(({ id }) => id)).toContain(
        CONTENT_SPACE_CAPABILITY_IDS.listProviderInstances
      )

      const humanReferenceQueries = [{
        id: CONTENT_SPACE_CAPABILITY_IDS.observeImmutableVersion,
        text: 'Observe Immutable Content Version'
      }, {
        id: CONTENT_SPACE_CAPABILITY_IDS.resolvePortalTarget,
        text: 'Resolve Content Space Portal Target'
      }, {
        id: CONTENT_SPACE_CAPABILITY_IDS.openPortalTarget,
        text: 'Open Content Space Portal Target'
      }]
      for (const { id, text } of humanReferenceQueries) {
        expect(registry.discover(caller, {
          text,
          scope: 'global',
          limit: 20
        }).map((definition) => definition.id)).not.toContain(id)
      }
    } finally {
      catalog.dispose()
    }
  })

  it('uses one approved Provider administration resource and requires fresh root-mutation confirmation', async () => {
    const createdRoot = toPortableContentContainerReference({
      providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
      containerId: 'mock_root'
    })
    const listSpaces = vi.fn(async () => Object.freeze({ items: Object.freeze([]) }))
    const createSpace = vi.fn(async (input: Readonly<{
      label: string
      contentOwnerUserId: string
    }>) => Object.freeze({
      root: createdRoot,
      label: input.label,
      contentOwnerUserId: input.contentOwnerUserId,
      pinned: false
    }))
    const removeMember = vi.fn(async (input: Readonly<{
      root: typeof createdRoot
      member: Readonly<{
        providerInstanceRef: string
        kind: 'user'
        principalId: string
      }>
    }>) => Object.freeze({ ...input, removed: true as const }))
    const unusedAdministrationOperation = vi.fn(async () => {
      throw new Error('Unexpected Provider administration operation.')
    })
    const administration = defineContentSpaceAdministrationPort({
      contractVersion: CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
      listSpaces,
      createSpace,
      observeSpace: unusedAdministrationOperation,
      updateSpace: unusedAdministrationOperation,
      pinSpace: unusedAdministrationOperation,
      unpinSpace: unusedAdministrationOperation,
      openRoot: unusedAdministrationOperation,
      listMembers: unusedAdministrationOperation,
      addMember: unusedAdministrationOperation,
      removeMember
    })
    const bind = vi.fn(async () => Object.freeze({ administration }))
    const providerEntry = createMockProviderFixtureEntry((provider) =>
      defineContentSpaceProvider({
        ...provider,
        features: Object.freeze({
          ...provider.features,
          administration: Object.freeze({
            describeOperations: () => Object.freeze(
              CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => Object.freeze({
                operation,
                readiness: 'production_ready' as const,
                reasonCode: 'available' as const
              }))
            ),
            bind
          })
        })
      })
    )
    const application = await activateContentSpaceTestApplication({
      userDataDir: join(tmpdir(), 'sciforge-content-space-administration-integration'),
      providerEntry,
      principal
    })

    try {
      const { broker } = application
      const authorizationInvocationId = 'content_space_authorize_administration_0001'
      const caller = {
        audience: 'agent' as const,
        callerId: 'agent:content-space-administration-integration',
        workspaceId: '/workspace',
        approvals: [{
          actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
          invocationId: authorizationInvocationId,
            mode: 'confirmation' as const
        }]
      }
      const authorized = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
        invocationId: authorizationInvocationId,
        input: { providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF }
      }, { signal: new AbortController().signal })

      expect(authorized).toMatchObject({
        output: {
          ok: true,
          value: {
            providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
            resource: { token: expect.stringMatching(/^cap_/u) }
          }
        },
        changed: false
      })
      expect(bind).not.toHaveBeenCalled()

      const resource = successValue<{ resource: NonNullable<typeof authorized.resource> }>(
        authorized.output
      ).resource
      await expect(broker.observe(caller, { resource })).resolves.toMatchObject({
        semanticRevision: resource.semanticRevision,
        state: { providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF }
      })

      const listed = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminListSpaces,
        resource,
        input: { page: { limit: 20 } }
      })
      expect(listed).toMatchObject({
        output: { ok: true, value: { items: [] } },
        changed: false
      })

      const created = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace,
        invocationId: 'content_space_administration_create_0002',
        resource,
        input: { label: 'Research Team' }
      }, { signal: new AbortController().signal })
      expect(created).toMatchObject({
        output: {
          ok: true,
          value: {
            space: { root: createdRoot, label: 'Research Team' },
            resource: { token: expect.stringMatching(/^cap_/u) }
          }
        },
        changed: true
      })
      expect(createSpace).toHaveBeenCalledOnce()
      expect(createSpace).toHaveBeenCalledWith({
        label: 'Research Team',
        contentOwnerUserId: principal.subject
      })
      expect(bind).toHaveBeenLastCalledWith(expect.objectContaining({
        invocationId: 'content_space_administration_create_0002'
      }))

      createSpace.mockClear()
      const surface = createCapabilityAgentToolSurface({
        broker,
        resolveCaller: () => ({
          audience: 'agent' as const,
          callerId: 'agent:content-space-administration-integration',
          workspaceId: '/workspace'
        }),
        requestApproval: async () => 'allowed' as const
      })
      const toolContext = (callId: string) => Object.freeze({
        requestId: callId,
        runtimeId: 'runtime:content-space-administration-integration',
        threadId: 'thread:content-space-administration-integration',
        turnId: 'turn:content-space-administration-integration',
        callId,
        workspaceId: '/workspace'
      })
      const operationRef = async (capabilityId: string, callId: string): Promise<string> => {
        const discovered = await surface.call({
          name: CAPABILITY_AGENT_TOOL_NAMES.discover,
          arguments: { capabilityId, includeSchema: true },
          context: toolContext(callId)
        })
        if (discovered.tool !== CAPABILITY_AGENT_TOOL_NAMES.discover ||
          discovered.value.length !== 1) {
          throw new Error(`Expected one discovered operation for ${capabilityId}.`)
        }
        return discovered.value[0]!.operationRef
      }

      const authorizeRef = await operationRef(
        CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
        'call:discover-authorize'
      )
      const agentAuthorized = await surface.call({
        name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
        arguments: {
          operationRef: authorizeRef,
          input: { providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF }
        },
        context: toolContext('call:authorize')
      }, { signal: new AbortController().signal })
      if (agentAuthorized.tool !== CAPABILITY_AGENT_TOOL_NAMES.invoke) {
        throw new Error('Expected an Agent authorization invocation.')
      }
      const administrationResourceRef = successValue<{
        resourceRef: string
      }>(agentAuthorized.value.output).resourceRef

      await expect(surface.call({
        name: CAPABILITY_AGENT_TOOL_NAMES.observe,
        arguments: { resourceRef: administrationResourceRef },
        context: toolContext('call:observe')
      })).resolves.toMatchObject({
        value: {
          resourceRef: administrationResourceRef,
          state: { providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF }
        }
      })

      const listRef = await operationRef(
        CONTENT_SPACE_CAPABILITY_IDS.agentAdminListSpaces,
        'call:discover-list'
      )
      await expect(surface.call({
        name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
        arguments: {
          operationRef: listRef,
          resourceRef: administrationResourceRef,
          input: { page: { limit: 20 } }
        },
        context: toolContext('call:list')
      })).resolves.toMatchObject({
        value: { output: { ok: true, value: { items: [] } }, changed: false }
      })

      const createRef = await operationRef(
        CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace,
        'call:discover-create'
      )
      await expect(surface.call({
        name: CAPABILITY_AGENT_TOOL_NAMES.invoke,
        arguments: {
          operationRef: createRef,
          resourceRef: administrationResourceRef,
          input: { label: 'Agent Research Team' }
        },
        context: toolContext('call:create')
      }, { signal: new AbortController().signal })).resolves.toMatchObject({
        value: {
          output: { ok: true, value: { space: { label: 'Agent Research Team' } } },
          changed: true
        }
      })
      expect(createSpace).toHaveBeenCalledOnce()
      expect(createSpace).toHaveBeenCalledWith({
        label: 'Agent Research Team',
        contentOwnerUserId: principal.subject
      })

      const ordinaryAuthorizationId = 'content_space_authorize_ordinary_root_0003'
      const ordinaryRoot = await broker.invoke({
        ...caller,
        approvals: [{
          actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
          invocationId: ordinaryAuthorizationId,
          mode: 'confirmation' as const
        }]
      }, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        invocationId: ordinaryAuthorizationId,
        input: {
          providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
          scope: 'personal',
          label: 'Local Content Space'
        }
      })
      const ordinaryResource = successValue<{
        resource: NonNullable<typeof ordinaryRoot.resource>
      }>(ordinaryRoot.output).resource
      const member = Object.freeze({
        providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
        kind: 'user' as const,
        principalId: 'provider-user-b'
      })
      const removalInvocationId = 'content_space_remove_member_0004'
      const removalRequest = Object.freeze({
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminRemoveMember,
        invocationId: removalInvocationId,
        resource: ordinaryResource,
        input: { member }
      })
      const bindCallsBeforeRemoval = bind.mock.calls.length

      await expect(broker.invoke(caller, removalRequest, {
        signal: new AbortController().signal
      })).rejects.toMatchObject({ code: 'approval_denied' })
      expect(bind).toHaveBeenCalledTimes(bindCallsBeforeRemoval)
      expect(removeMember).not.toHaveBeenCalled()
    } finally {
      await application.dispose()
    }
  })

  it('executes the ordinary Content Space provisioning chain only through one exact approved batch', async () => {
    const createdRoot = toPortableContentContainerReference({
      providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
      containerId: 'approved_batch_root'
    })
    const member = Object.freeze({
      providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: 'provider-user-batch-worker'
    })
    const providerMembers: typeof member[] = []
    const providerCalls: string[] = []
    const administration = defineContentSpaceAdministrationPort({
      contractVersion: CONTENT_SPACE_ADMINISTRATION_CONTRACT_VERSION,
      listSpaces: async () => Object.freeze({ items: Object.freeze([]) }),
      createSpace: async (input) => {
        providerCalls.push(`create:${input.label}`)
        return Object.freeze({
          root: createdRoot,
          label: input.label,
          contentOwnerUserId: input.contentOwnerUserId,
          pinned: false
        })
      },
      observeSpace: async () => { throw new Error('Unexpected observe-space operation.') },
      updateSpace: async () => { throw new Error('Unexpected update-space operation.') },
      pinSpace: async () => { throw new Error('Unexpected pin-space operation.') },
      unpinSpace: async () => { throw new Error('Unexpected unpin-space operation.') },
      openRoot: async () => { throw new Error('Unexpected open-root operation.') },
      listMembers: async (input) => {
        providerCalls.push(`list:${providerMembers.length}`)
        return Object.freeze({
          root: input.root,
          items: Object.freeze(providerMembers.map((providerMember) => Object.freeze({
            member: providerMember
          })))
        })
      },
      addMember: async (input) => {
        providerCalls.push(`add:${input.member.principalId}`)
        providerMembers.push(input.member as typeof member)
        return Object.freeze({ root: input.root, member: input.member })
      },
      removeMember: async () => { throw new Error('Unexpected remove-member operation.') }
    })
    const bind = vi.fn(async () => Object.freeze({ administration }))
    const providerEntry = createMockProviderFixtureEntry((provider) =>
      defineContentSpaceProvider({
        ...provider,
        features: Object.freeze({
          ...provider.features,
          administration: Object.freeze({
            describeOperations: () => Object.freeze(
              CONTENT_SPACE_ADMINISTRATION_OPERATIONS.map((operation) => Object.freeze({
                operation,
                readiness: 'production_ready' as const,
                reasonCode: 'available' as const
              }))
            ),
            bind
          })
        })
      })
    )
    const application = await activateContentSpaceTestApplication({
      userDataDir: join(tmpdir(), 'sciforge-content-space-approved-batch-integration'),
      providerEntry,
      principal
    })

    try {
      const { broker } = application
      const invoker = createMainSystemCapabilityInvokerFactory(broker).forDomain(
        { moduleId: 'sciforge.project-coordinator', moduleVersion: '1.0.0' },
        [CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID]
      )
      await expect(invoker.invoke(
        CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT,
        { providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF },
        { idempotencyKey: 'standing-grant-must-not-authorize' }
      )).rejects.toMatchObject({ code: 'delegated_batch_proof_denied' })
      expect(bind).not.toHaveBeenCalled()

      const plan = domainMainFiniteCapabilityBatchPlanSchema.parse({
        requiredSystemCapabilityGrant: CONTENT_SPACE_PROVISIONING_BATCH_GRANT_ID,
        revision: 'project-content:project-11:11',
        operations: [
          {
            operationId: 'authorize',
            actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeProviderAdministration,
            idempotencyKey: 'project-11-revision-11-authorize',
            input: { providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF }
          },
          {
            operationId: 'create',
            actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminCreateSpace,
            idempotencyKey: 'project-11-revision-11-create',
            input: { label: 'Project 11 Team' },
            resource: {
              kind: 'operation-output', operationId: 'authorize', path: ['value', 'resource']
            }
          },
          {
            operationId: 'list-before',
            actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminListMembers,
            input: { page: { limit: 200 } },
            resource: {
              kind: 'operation-output', operationId: 'create', path: ['value', 'resource']
            }
          },
          {
            operationId: 'add-member',
            actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminAddMember,
            idempotencyKey: 'project-11-revision-11-add-worker',
            input: { member },
            resource: {
              kind: 'operation-output', operationId: 'create', path: ['value', 'resource']
            }
          },
          {
            operationId: 'list-after',
            actionId: CONTENT_SPACE_CAPABILITY_IDS.agentAdminListMembers,
            input: { page: { limit: 200 } },
            resource: {
              kind: 'operation-output', operationId: 'create', path: ['value', 'resource']
            }
          }
        ]
      })
      const confirmedPlanDigest = createHash('sha256')
        .update(canonicalizeDomainMainFiniteCapabilityBatchPlan(plan))
        .digest('hex')
      const outer = defineCapability({
        id: 'fixture.project-content.provision',
        version: '1.0.0',
        title: 'Confirm exact Project content provisioning',
        description: 'Binds one Human confirmation to the exact immutable provisioning revision.',
        audiences: ['ui'],
        scope: 'global',
        effect: 'external-write',
        approval: 'confirmation',
        concurrency: { revision: 'none', idempotency: 'required' },
        inputSchema: z.object({
          revision: z.literal(11),
          confirmedPlanDigest: domainMainFiniteCapabilityBatchPlanDigestSchema
        }).strict(),
        outputSchema: z.object({ memberCount: z.number().int() }).strict(),
        handler: async () => {
          const batch = invoker.createApprovedBatch(plan)
          const controller = new AbortController()
          await batch.invoke(
            'authorize',
            CONTENT_SPACE_AUTHORIZE_PROVIDER_ADMINISTRATION_CONTRACT,
            { signal: controller.signal }
          )
          await batch.invoke(
            'create',
            CONTENT_SPACE_AGENT_ADMIN_CREATE_SPACE_CONTRACT,
            { signal: controller.signal }
          )
          const before = await batch.invoke(
            'list-before',
            CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT
          )
          if (!before.ok || before.value.items.length !== 0) {
            throw new Error('The exact first member observation is invalid.')
          }
          await batch.invoke(
            'add-member',
            CONTENT_SPACE_AGENT_ADMIN_ADD_MEMBER_CONTRACT,
            { signal: controller.signal }
          )
          const after = await batch.invoke(
            'list-after',
            CONTENT_SPACE_AGENT_ADMIN_LIST_MEMBERS_CONTRACT
          )
          if (!after.ok) throw new Error('The exact final member observation failed.')
          return { output: { memberCount: after.value.items.length } }
        }
      })
      broker.registry.register(outer)

      await expect(broker.invoke({
        audience: 'ui',
        callerId: 'window:project-owner',
        approvals: [{
          actionId: outer.descriptor.id,
          invocationId: 'project-11-revision-11-human-confirmation',
          mode: 'confirmation'
        }]
      }, {
        actionId: outer.descriptor.id,
        invocationId: 'project-11-revision-11-human-confirmation',
        input: { revision: 11, confirmedPlanDigest }
      })).resolves.toMatchObject({ output: { memberCount: 1 } })
      expect(providerCalls).toEqual([
        'create:Project 11 Team',
        'list:0',
        `add:${member.principalId}`,
        'list:1'
      ])
      expect(bind).toHaveBeenCalledTimes(4)
    } finally {
      await application.dispose()
    }
  })

  it('requires fresh confirmation before deleting a listed ordinary child', async () => {
    const execute = vi.fn<ContentSpaceExtendedOperationsExecutor['execute']>(async (input) => {
      const request = input.request as Readonly<{ entries: readonly unknown[] }>
      return Object.freeze({
        ok: true as const,
        value: Object.freeze({
          deleted: Object.freeze([...request.entries]),
          failed: Object.freeze([])
        })
      })
    })
    const providerEntry = createMockProviderFixtureEntry((provider) =>
      defineContentSpaceProvider({
        ...provider,
        features: Object.freeze({
          ...provider.features,
          extendedOperations: Object.freeze({
            describeOperations: () => Object.freeze([Object.freeze({
              operation: 'deleteEntries' as const,
              readiness: 'production_ready' as const,
              reasonCode: 'available' as const
            })]),
            execute
          })
        })
      })
    )
    const application = await activateContentSpaceTestApplication({
      userDataDir: join(
        tmpdir(),
        'sciforge-content-space-destructive-confirmation-integration'
      ),
      providerEntry,
      principal
    })

    try {
      const { broker } = application
      const caller = Object.freeze({
        audience: 'agent' as const,
        callerId: 'agent:content-space-destructive-confirmation-integration',
        workspaceId: '/workspace'
      })
      const authorizationInvocationId = 'content_space_destructive_authorize_0001'
      const authorized = await broker.invoke({
        ...caller,
        approvals: [{
          actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
          invocationId: authorizationInvocationId,
          mode: 'confirmation' as const
        }]
      }, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        invocationId: authorizationInvocationId,
        input: {
          providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
          scope: 'personal',
          label: 'Local Content Space'
        }
      })
      const root = successValue<{ resource: NonNullable<typeof authorized.resource> }>(
        authorized.output
      ).resource

      const created = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        invocationId: 'content_space_destructive_create_0002',
        resource: root,
        input: { name: 'Disposable' }
      }, { signal: new AbortController().signal })
      const listed = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        resource: created.resource!,
        input: { page: { limit: 20 } }
      })
      const child = successValue<{
        items: Array<{
          entry: Readonly<{
            kind: string
            label: string
            reference: Readonly<{ providerInstanceRef: string; containerId: string }>
          }>
          resource: NonNullable<typeof created.resource>
        }>
      }>(listed.output).items.find(({ entry }) =>
        entry.kind === 'container' && entry.label === 'Disposable'
      )
      expect(child).toBeDefined()

      await expect(broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentExtendedDestructive,
        invocationId: 'content_space_destructive_delete_0003',
        resource: child!.resource,
        input: {
          operation: 'deleteEntries',
          request: { entries: [child!.entry.reference] }
        }
      }, { signal: new AbortController().signal })).rejects.toMatchObject({
        code: 'approval_denied'
      })
      expect(execute).not.toHaveBeenCalled()
    } finally {
      await application.dispose()
    }
  })

  it('round-trips an authorized Workspace file through real Broker and Host transfers', async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), 'sciforge-content-space-transfer-'))
    const workspace = join(rootDirectory, 'workspace')
    const temporary = join(rootDirectory, 'temporary')
    const userData = join(rootDirectory, 'user-data')
    await Promise.all([
      mkdir(join(workspace, 'outputs'), { recursive: true }),
      mkdir(join(workspace, 'inputs'), { recursive: true }),
      mkdir(temporary, { recursive: true }),
      mkdir(userData, { recursive: true })
    ])
    const uploadBytes = new TextEncoder().encode('real Broker and Host transfer')
    await writeFile(join(workspace, 'outputs', 'result.txt'), uploadBytes)

    let broker: CapabilityBroker | undefined
    let application: Awaited<ReturnType<typeof activateContentSpaceTestApplication>> | undefined
    const transfers = new HostFileTransferService({
      temporaryRoot: temporary,
      isPrincipalCurrent: (candidate) => samePrincipalSnapshot(candidate, principal)
    })
    const providerEntry = createMockProviderFixtureEntry()

    try {
      application = await activateContentSpaceTestApplication({
        userDataDir: userData,
        providerEntry,
        principal,
        applicationHost: {
          fileTransfersFor: (owner) => transfers.forOwner(
            owner.moduleId,
            () => broker?.currentInvocation()
          )
        }
      })
      broker = application.broker
      const caller = Object.freeze({
        audience: 'agent' as const,
        callerId: 'agent:content-space-real-transfer',
        workspaceId: workspace
      })
      const authorizeInvocationId = 'content_space_real_transfer_authorize_0001'
      const authorized = await broker.invoke({
        ...caller,
        approvals: [{
          actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
          invocationId: authorizeInvocationId,
          mode: 'confirmation' as const
        }]
      }, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        invocationId: authorizeInvocationId,
        input: {
          providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
          scope: 'personal',
          label: 'Local Content Space'
        }
      })
      const root = successValue<{ resource: NonNullable<typeof authorized.resource> }>(
        authorized.output
      ).resource

      const created = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        invocationId: 'content_space_real_transfer_create_0002',
        resource: root,
        input: { name: 'Results' }
      }, { signal: new AbortController().signal })
      expect(created.output).toMatchObject({ ok: true, value: { name: 'Results' } })
      expect(created).toMatchObject({
        changed: true,
        resource: { semanticRevision: expect.any(String) }
      })
      const rootListing = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        resource: created.resource!,
        input: { page: { limit: 20 } }
      })
      const folder = successValue<{
        items: Array<{
          entry: Readonly<{ kind: string; label: string }>
          resource: NonNullable<typeof created.resource>
        }>
      }>(rootListing.output).items.find(({ entry }) =>
        entry.kind === 'container' && entry.label === 'Results'
      )
      expect(folder).toBeDefined()

      const uploaded = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        invocationId: 'content_space_real_transfer_upload_0003',
        resource: folder!.resource,
        input: { name: 'result.txt', workspaceRelativePath: 'outputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(uploaded).toMatchObject({
        output: { ok: true, value: { sourceSize: uploadBytes.byteLength } },
        changed: true
      })

      const conflictingUpload = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        invocationId: 'content_space_real_transfer_upload_conflict_0004',
        resource: uploaded.resource!,
        input: { name: 'result.txt', workspaceRelativePath: 'outputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(conflictingUpload).toMatchObject({
        output: {
          ok: false,
          error: { code: 'conflict', retry: 'after-human-action' }
        },
        changed: false
      })

      const folderListing = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        resource: uploaded.resource!,
        input: { page: { limit: 20 } }
      })
      const files = successValue<{
        items: Array<{
          entry: Readonly<{ kind: string; label: string }>
          resource: NonNullable<typeof uploaded.resource>
        }>
      }>(folderListing.output).items.filter(({ entry }) =>
        entry.kind === 'file' && entry.label === 'result.txt'
      )
      expect(files).toHaveLength(1)
      const file = files[0]
      expect(file).toBeDefined()

      const downloaded = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_real_transfer_download_0005',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(downloaded).toMatchObject({
        output: { ok: true, value: { bytesWritten: uploadBytes.byteLength } },
        changed: false
      })
      await expect(readFile(join(workspace, 'inputs', 'result.txt')))
        .resolves.toEqual(Buffer.from(uploadBytes))

      const conflictingDownload = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_real_transfer_download_conflict_0006',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(conflictingDownload).toMatchObject({
        output: {
          ok: false,
          error: { code: 'conflict', retry: 'after-human-action' }
        },
        changed: false
      })
      await expect(readFile(join(workspace, 'inputs', 'result.txt')))
        .resolves.toEqual(Buffer.from(uploadBytes))
    } finally {
      await application?.dispose()
      await transfers.dispose()
      await rm(rootDirectory, { recursive: true, force: true })
    }
  })

  it('invokes authorized create, upload, and download through the real Broker receipt path', async () => {
    const uploadBytes = new TextEncoder().encode('broker receipt integration')
    const downloaded: Uint8Array[] = []
    const openWorkspaceUploadSource = vi.fn(async () => Object.freeze({
      name: 'result.txt',
      size: uploadBytes.byteLength,
      sha256: createHash('sha256').update(uploadBytes).digest('hex'),
      read: async ({ offset, length }: Readonly<{ offset: number; length: number }>) =>
        uploadBytes.slice(offset, Math.min(offset + length, uploadBytes.byteLength)),
      close: vi.fn(async () => undefined)
    }))
    const commit = vi.fn(async () => undefined)
    const unknownCommit = vi.fn(async () => { throw new Error('commit outcome unavailable') })
    const openWorkspaceDownloadDestination = vi.fn(async (
      { relativePath }: Readonly<{ relativePath: string }>
    ) => Object.freeze({
      label: relativePath,
      write: async (chunk: Uint8Array) => { downloaded.push(chunk.slice()) },
      commit: relativePath === 'inputs/unknown-result.txt' ? unknownCommit : commit,
      abort: vi.fn(async () => undefined)
    }))
    const fileTransfers = Object.freeze({
      openUploadSource: vi.fn(async () => { throw new Error('UI upload path was used.') }),
      openDownloadDestination: vi.fn(async () => { throw new Error('UI download path was used.') }),
      openWorkspaceUploadSource,
      openWorkspaceDownloadDestination
    })
    const nativeReadInvocationIds: string[] = []
    const extendedReadInvocationIds: string[] = []
    const nativeReadExecute: ContentSpaceNativeDocumentExecutor['execute'] = vi.fn(async (input) => {
      const invocationId = input.context.invocationId
      if (!invocationId || !('fileId' in input.target.primary)) {
        throw new Error('Native read was not invocation- and file-bound.')
      }
      nativeReadInvocationIds.push(invocationId)
      return Object.freeze({
        contractVersion: '1.0.0' as const,
        resourceType: 'native_document' as const,
        operation: 'read' as const,
        invocationId,
        outcome: 'succeeded' as const,
        result: Object.freeze({
          kind: 'content' as const,
          document: Object.freeze({
            resourceType: 'native_document' as const,
            reference: input.target.primary
          }),
          documentHash: 'a'.repeat(64),
          content: Object.freeze({ type: 'doc' })
        })
      })
    })
    const extendedReadExecute: ContentSpaceExtendedOperationsExecutor['execute'] = vi.fn(
      async (input) => {
        const invocationId = input.context.invocationId
        if (!invocationId || input.operation !== 'getEntryInfo' ||
          !('fileId' in input.target.primary)) {
          throw new Error('Extended read was not invocation- and file-bound.')
        }
        extendedReadInvocationIds.push(invocationId)
        return Object.freeze({
          ok: true as const,
          value: Object.freeze({
            kind: 'file' as const,
            reference: input.target.primary,
            name: 'result.txt',
            parent: input.target.root,
            size: uploadBytes.byteLength
          })
        })
      }
    )
    const providerEntry = createMockProviderFixtureEntry((provider) =>
      defineContentSpaceProvider({
        ...provider,
        features: Object.freeze({
          ...provider.features,
          nativeDocuments: Object.freeze({
            describeOperations: () => Object.freeze(
              NATIVE_DOCUMENT_OPERATIONS.map((operation) => Object.freeze({
                operation,
                readiness: 'production_ready' as const,
                reasonCode: 'available' as const
              }))
            ),
            execute: nativeReadExecute
          }),
          extendedOperations: Object.freeze({
            describeOperations: () => Object.freeze([Object.freeze({
              operation: 'getEntryInfo' as const,
              readiness: 'production_ready' as const,
              reasonCode: 'available' as const
            })]),
            execute: extendedReadExecute
          })
        })
      })
    )
    const application = await activateContentSpaceTestApplication({
      userDataDir: join(tmpdir(), 'sciforge-content-space-broker-integration'),
      providerEntry,
      principal,
      applicationHost: { fileTransfersFor: () => fileTransfers }
    })

    try {
      const { broker } = application
      const caller = Object.freeze({
        audience: 'agent' as const,
        callerId: 'agent:content-space-broker-integration',
        workspaceId: '/workspace'
      })
      const authorizeInvocationId = 'content_space_authorize_root_0001'
      const authorized = await broker.invoke({
        ...caller,
        approvals: [{
          actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
          invocationId: authorizeInvocationId,
          mode: 'confirmation' as const
        }]
      }, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.authorizeAgentRoot,
        invocationId: authorizeInvocationId,
        input: {
          providerInstanceRef: LOCAL_MOCK_PROVIDER_INSTANCE_REF,
          scope: 'personal',
          label: 'Local Content Space'
        }
      })
      const root = successValue<{ resource: NonNullable<typeof authorized.resource> }>(
        authorized.output
      ).resource

      const created = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        invocationId: 'content_space_create_folder_0002',
        resource: root,
        input: { name: 'Results' }
      }, { signal: new AbortController().signal })
      expect(created).toMatchObject({
        output: { ok: true, value: { name: 'Results' } },
        changed: true,
        beforeRevision: root.semanticRevision,
        resource: { semanticRevision: expect.any(String) }
      })
      expect(created.afterRevision).not.toBe(created.beforeRevision)

      const uploaded = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        invocationId: 'content_space_upload_file_0003',
        resource: created.resource!,
        input: { name: 'result.txt', workspaceRelativePath: 'outputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(uploaded).toMatchObject({
        output: {
          ok: true,
          value: { name: 'result.txt', sourceSize: uploadBytes.byteLength }
        },
        changed: true,
        resource: { semanticRevision: expect.any(String) }
      })
      expect(uploaded.afterRevision).not.toBe(uploaded.beforeRevision)

      const listed = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentListEntries,
        resource: uploaded.resource!,
        input: { page: { limit: 20 } }
      })
      const file = successValue<{
        items: Array<{
          entry: {
            kind: string
            label: string
            reference: Readonly<{ providerInstanceRef: string; fileId?: string }>
          }
          resource: NonNullable<typeof uploaded.resource>
        }>
      }>(listed.output).items.find(({ entry }) =>
        entry.kind === 'file' && entry.label === 'result.txt'
      )
      expect(file).toBeDefined()

      const nativeRead = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentNativeDocumentRead,
        resource: file!.resource,
        input: {
          request: {
            operation: 'read',
            document: {
              resourceType: 'native_document',
              reference: file!.entry.reference
            }
          }
        }
      })
      expect(nativeRead).toMatchObject({
        output: {
          ok: true,
          value: { outcome: 'succeeded', operation: 'read' }
        },
        changed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(nativeRead.resource).toBeUndefined()
      expect(nativeReadInvocationIds).toEqual([expect.stringMatching(/^read_[a-f0-9]{32}$/u)])

      const extendedRead = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentExtendedRead,
        resource: file!.resource,
        input: {
          operation: 'getEntryInfo',
          request: { reference: file!.entry.reference }
        }
      })
      expect(extendedRead).toMatchObject({
        output: {
          ok: true,
          value: { ok: true, value: { kind: 'file', name: 'result.txt' } }
        },
        changed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(extendedRead.resource).toBeUndefined()
      expect(extendedReadInvocationIds).toEqual([
        expect.stringMatching(/^read_[a-f0-9]{32}$/u)
      ])

      const downloadedResult = await broker.invoke(caller, {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_download_file_0004',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/result.txt' }
      }, { signal: new AbortController().signal })
      expect(downloadedResult).toMatchObject({
        output: { ok: true, value: { bytesWritten: uploadBytes.byteLength } },
        changed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(downloadedResult.resource).toBeUndefined()
      expect(Buffer.concat(downloaded.map((chunk) => Buffer.from(chunk))))
        .toEqual(Buffer.from(uploadBytes))
      expect(commit).toHaveBeenCalledOnce()
      expect(openWorkspaceUploadSource).toHaveBeenCalledOnce()
      expect(openWorkspaceDownloadDestination).toHaveBeenCalledOnce()

      const outcomeUnknownRequest = {
        actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload,
        invocationId: 'content_space_download_unknown_0005',
        resource: file!.resource,
        input: { workspaceRelativePath: 'inputs/unknown-result.txt' }
      }
      const outcomeUnknown = await broker.invoke(
        caller,
        outcomeUnknownRequest,
        { signal: new AbortController().signal }
      )
      const replayedUnknown = await broker.invoke(
        caller,
        outcomeUnknownRequest,
        { signal: new AbortController().signal }
      )
      expect(outcomeUnknown).toMatchObject({
        output: { ok: false, error: { code: 'outcome_unknown', retry: 'never' } },
        changed: false,
        replayed: false,
        beforeRevision: file!.resource.semanticRevision,
        afterRevision: file!.resource.semanticRevision
      })
      expect(replayedUnknown).toMatchObject({
        output: { ok: false, error: { code: 'outcome_unknown', retry: 'never' } },
        changed: false,
        replayed: true
      })
      expect(unknownCommit).toHaveBeenCalledOnce()
      expect(openWorkspaceDownloadDestination).toHaveBeenCalledTimes(2)

      const writeAudit = broker.listAuditRecords().filter(({ actionId }) => [
        CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder,
        CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew,
        CONTENT_SPACE_CAPABILITY_IDS.agentDownload
      ].includes(actionId as typeof CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder))
      expect(writeAudit.slice(0, 3)).toMatchObject([
        { actionId: CONTENT_SPACE_CAPABILITY_IDS.agentCreateFolder, approval: 'none' },
        { actionId: CONTENT_SPACE_CAPABILITY_IDS.agentUploadNew, approval: 'none' },
        { actionId: CONTENT_SPACE_CAPABILITY_IDS.agentDownload, approval: 'none' }
      ])
    } finally {
      await application.dispose()
    }
  })
})

function successValue<Value>(output: unknown): Value {
  if (!output || typeof output !== 'object' || !('ok' in output) || output.ok !== true || !('value' in output)) {
    throw new Error('Expected a successful Content Space result.')
  }
  return output.value as Value
}

function createMockProviderFixtureEntry(
  transformProvider: (
    provider: ContentSpaceProvider
  ) => ContentSpaceProvider | Promise<ContentSpaceProvider> = (provider) => provider
): TrustedDomainProcessEntryInput<unknown> {
  const entry = createMockProviderMainEntry(Object.freeze({}) as DomainMainHost)
  let replacedFactory = false
  const contributions = entry.contributions.map((contribution) => {
    const candidate = contribution.value as Partial<
      ContentSpaceProviderFactoryRuntimeValue<ContentSpaceProvider, unknown>
    >
    if (candidate.location !== MAIN_CONTENT_SPACE_PROVIDER_FACTORY_LOCATION ||
      !candidate.createProvider || !candidate.contractVersion || !candidate.providerKind) {
      return contribution
    }
    replacedFactory = true
    const original = candidate as ContentSpaceProviderFactoryRuntimeValue<
      ContentSpaceProvider,
      unknown
    >
    return Object.freeze({
      ...contribution,
      value: defineContentSpaceProviderFactory<ContentSpaceProvider, unknown>({
        contractVersion: original.contractVersion,
        providerKind: original.providerKind,
        createProvider: async (hostView) => transformProvider(
          await original.createProvider(hostView)
        )
      })
    })
  })
  if (!replacedFactory) throw new Error('Mock Provider manifest has no Provider factory.')
  return Object.freeze({
    ...entry,
    contributions: Object.freeze(contributions)
  })
}

function createTestApplicationCatalog(
  userDataDir: string,
  overrides: Partial<Parameters<typeof createApplicationDomainCatalog>[0]> = {}
) {
  return createApplicationDomainCatalog({
    getUserDataDir: () => userDataDir,
    getDeviceId: () => 'content-space-discovery-test-device',
    packageStorageFor: createNonSecretPackageStorageForTest(),
    capabilityInvokerFor: () => Object.freeze({
      invoke: async () => {
        throw new Error('Domain system capabilities are unavailable in this test.')
      },
      createApprovedBatch: () => {
        throw new Error('Domain system capabilities are unavailable in this test.')
      }
    }),
    ...overrides
  })
}

function unavailableDependencies(): AppCapabilityDependencies {
  const unavailable = () => undefined
  return new Proxy({}, {
    get: () => unavailable
  }) as AppCapabilityDependencies
}

async function activateContentSpaceTestApplication(input: Readonly<{
  userDataDir: string
  providerEntry: TrustedDomainProcessEntryInput<unknown>
  principal: PrincipalSnapshot
  applicationHost?: Partial<Parameters<typeof createApplicationDomainCatalog>[0]>
}>) {
  const catalog = createTestApplicationCatalog(input.userDataDir, input.applicationHost)
  for (const definition of catalog.listPackages()) {
    if (
      definition.module.id === CONTENT_SPACE_DOMAIN_MODULE_ID ||
      definition.packageName.startsWith('@sciforge/core-')
    ) continue
    catalog.unregisterModule(definition.module.id)
  }
  catalog.registerModule(input.providerEntry)

  const broker = new CapabilityBroker(
    createApplicationCapabilityRegistry(catalog, unavailableDependencies()),
    { resolveCurrentPrincipal: () => input.principal }
  )
  try {
    const activated = await activateMainRuntimeContributions(catalog, {
      userDataDir: input.userDataDir,
      appRoot: input.userDataDir,
      environment: Object.freeze({ NODE_ENV: 'test' }),
      agentThreads: {
        list: async () => [],
        read: async ({ runtimeId, threadId }) => ({
          id: threadId,
          runtimeId,
          watermark: '0',
          turns: [],
          artifacts: []
        }),
        subscribeMessages: async function* () {},
        hasActiveTurns: () => false
      },
      capabilityInvokers: createMainSystemCapabilityInvokerFactory(broker),
      executionEvents: {
        publish: async () => {
          throw new Error('Execution events are unavailable in this test.')
        }
      },
      modelAccess: { textReasoner: async () => null },
      enablement: {
        isEnabled: async () => true,
        subscribe: () => () => undefined
      },
      log: () => undefined
    })
    return Object.freeze({
      broker,
      dispose: async () => {
        try {
          await activated.dispose()
        } finally {
          catalog.dispose()
        }
      }
    })
  } catch (error) {
    catalog.dispose()
    throw error
  }
}
