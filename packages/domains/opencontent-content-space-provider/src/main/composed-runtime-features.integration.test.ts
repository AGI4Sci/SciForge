import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  DOCFLOW_COMMAND_RESULT_PROTOCOL
} from '@sciforge/opencontent-skill-runtime/main/docflow-native-document-adapter'
import {
  OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR
} from '@sciforge/opencontent-skill-runtime/main/bundled-assets'
import {
  OPENCONTENT_CLI_RESULT_PROTOCOL
} from '@sciforge/opencontent-skill-runtime/main/extended-operation-adapter'
import {
  toPortableContentContainerReference,
  type ContentSpaceProvider
} from '@sciforge/domain-content-space/contract'
import type {
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor
} from '@sciforge/domain-content-space/provider-features'
import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import type { DomainMainHost } from '@sciforge/domain-sdk/host'
import type {
  DomainMainPackageSettingsHost,
  DomainMainProviderCredentialStoreHost
} from '@sciforge/domain-sdk/package-storage'
import {
  canonicalJson,
  createStaticFileInventory,
  digestInventory
} from '@sciforge/internal-runtime-integrity'
import {
  PROVIDER_FACTORY_CONTRACT_VERSION,
  defineProviderInstanceDirectoryEntry
} from '@sciforge/domain-sdk/provider-composition'
import {
  OPENCONTENT_PROVIDER_INSTANCE_REF,
  OPENCONTENT_PROVIDER_KIND,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'
import {
  createDomainMainEntry as createConnectorMainEntry
} from '@sciforge/domain-opencontent-connector/main'

import { createDomainMainEntry as createProviderMainEntry } from './index.js'

const SYSTEM_USER_TOKEN = 'system-user-token-canary-00000001'
const SITE = 'https://test1.edoc2.com'
const DOCUMENT_HASH = 'a'.repeat(64)
const NEXT_DOCUMENT_HASH = 'b'.repeat(64)
const DEADLINE = '2099-08-20T12:00:00.000Z'
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'content-owner',
  assurance: 'local-selection' as const,
  deviceId: 'opencontent-composed-runtime-test',
  identityVersion: 1
})
const root = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  containerId: 'team-root-guid'
})
const file = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  fileId: 'document-one'
})
const document = Object.freeze({
  resourceType: 'native_document' as const,
  reference: file
})
const staleExternalBinding = Object.freeze({
  providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
  principal,
  externalSubject: 'c'.repeat(64),
  bindingRevision: 'd'.repeat(64)
})
const assetFixture = createAssetFixture()
afterAll(() => assetFixture.dispose())

describe('composed OpenContent runtime features', () => {
  it('runs native, extended, and administration reads/writes through one v3 facade', async () => {
    const observedPrivateRequests: unknown[] = []
    const fetchImplementation = providerFetch()
    const internalServices = inMemoryInternalServices()
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), {
      fetch: fetchImplementation,
      skillRuntime: {
        processPort: {
          run: vi.fn(async (request) => {
            observedPrivateRequests.push(request)
            const invocation = request.invocation
            if (invocation.command === 'docflow-read') {
              const documentHash = invocation.args.fileId === 'created-document'
                ? NEXT_DOCUMENT_HASH
                : DOCUMENT_HASH
              return {
                protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
                command: invocation.command,
                ok: true,
                json: {
                  success: true,
                  operation: 'read',
                  fileId: invocation.args.fileId,
                  document: { documentHash, type: 'doc', children: [] }
                },
                structuredDeliveryItems: [],
                managedDataFiles: []
              }
            }
            if (invocation.command === 'docflow-create') {
              return {
                protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
                command: invocation.command,
                ok: true,
                json: {
                  success: true,
                  operation: 'create',
                  fileId: 'created-document',
                },
                structuredDeliveryItems: [{
                  protocolVersion: '1.0',
                  kind: 'docflowCard',
                  version: 'v1',
                  businessIdentity: 'created-document',
                  outcome: 'succeeded',
                  payload: {
                    projectId: 'created-document',
                    versionId: 'version-created',
                    name: 'Draft.mdoc',
                    versionName: '',
                    accessUrl: 'https://provider.invalid/preview/created-document',
                    updateTime: '2026-08-20T10:00:00+08:00'
                  }
                }],
                managedDataFiles: []
              }
            }
            const json = invocation.command === 'file-info'
              ? {
                  success: true,
                  data: {
                    fileGuid: file.fileId,
                    fileName: 'Draft.mdoc',
                    folderGuid: root.containerId,
                    fileSize: 128,
                    fileModifyTime: '2026-08-20T00:00:00.000Z',
                    fileLastVerNumStr: '1.0'
                  }
                }
              : invocation.command === 'rename'
                ? {
                    success: true,
                    data: {
                      id: file.fileId,
                      type: 'file',
                      newName: 'Renamed.mdoc'
                    }
                  }
                : { success: true, data: {} }
            return {
              protocol: OPENCONTENT_CLI_RESULT_PROTOCOL,
              invocationId: invocation.invocationId,
              command: invocation.command,
              attemptCount: 1,
              outcome: 'succeeded',
              json,
              structuredDeliveryItems: [],
              managedDataFiles: []
            }
          })
        }
      }
    })

    const provider = composedProvider(internalServices)
    const native = requiredNativeFeature(provider)
    const extended = requiredExtendedFeature(provider)
    const signal = new AbortController().signal

    const nativeRead = await native.execute(nativeInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_native_read_0001',
      operation: 'read',
      request: { operation: 'read', document },
      primary: file
    }))
    const nativeWrite = await native.execute(nativeInput({
      effect: 'external-write',
      signal,
      invocationId: 'invocation_native_write_0001',
      operation: 'create',
      request: {
        operation: 'create',
        resourceType: 'native_document',
        parent: root,
        title: 'Draft',
        content: { encoding: 'json', value: { type: 'doc', children: [] } }
      },
      primary: root
    }))
    const extendedRead = await extended.execute(extendedInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_extended_read_0001',
      operation: 'getEntryInfo',
      request: { reference: file }
    }))
    const extendedWrite = await extended.execute(extendedInput({
      effect: 'external-write',
      signal,
      invocationId: 'invocation_extended_write_0001',
      operation: 'renameEntry',
      request: { target: file, name: 'Renamed.mdoc' }
    }))

    expect(nativeRead).toMatchObject({
      outcome: 'succeeded',
      result: { kind: 'content', documentHash: DOCUMENT_HASH }
    })
    expect(nativeWrite).toMatchObject({
      outcome: 'succeeded',
      result: { kind: 'document', documentHash: NEXT_DOCUMENT_HASH }
    })
    expect(extendedRead).toMatchObject({
      ok: true,
      value: { kind: 'file', name: 'Draft.mdoc' }
    })
    expect(extendedWrite).toEqual({
      ok: true,
      value: { target: file, name: 'Renamed.mdoc' }
    })
    const operationContext = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    }
    const nativeOperations = await native.describeOperations(operationContext)
    expect(nativeOperations).toHaveLength(20)
    expect(nativeOperations.filter((state) => state.readiness === 'blocked_by_contract')
      .map((state) => state.operation).sort()).toEqual([
        'comment-create',
        'comment-delete',
        'comment-reopen',
        'comment-reply',
        'comment-solve',
        'edit',
        'import',
        'insert',
        'redo',
        'undo',
        'update'
      ])
    expect(nativeOperations.filter((state) => state.readiness === 'poc_only'))
      .toHaveLength(9)
    expect(nativeOperations.filter((state) => state.readiness === 'poc_only')
      .every((state) => state.reasonCode === 'verification_profile_required')).toBe(true)

    const extendedOperations = await extended.describeOperations(operationContext)
    expect(extendedOperations).toHaveLength(54)
    expect(extendedOperations.filter((state) => state.readiness === 'blocked_by_contract'))
      .toEqual([{
      operation: 'updateFileVersion',
      readiness: 'blocked_by_contract',
      reasonCode: 'provider_contract_missing'
    }])
    expect(extendedOperations.filter((state) => state.operation !== 'updateFileVersion')
      .every((state) => (
        state.readiness === 'poc_only' &&
        state.reasonCode === 'verification_profile_required'
      ))).toBe(true)

    const administration = await provider.features?.administration?.bind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_administration_read_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    })
    await expect(administration?.administration.listSpaces({
      page: { limit: 10 }
    })).resolves.toMatchObject({
      items: [{ label: 'Research Team', contentOwnerUserId: principal.subject }]
    })

    const processRequests = observedPrivateRequests.map(privateProcessRequest)
    expect(processRequests.map((request) => request.invocation.command)).toEqual([
      'docflow-read',
      'docflow-create',
      'docflow-read',
      'file-info',
      'rename'
    ])
    expect(processRequests.filter(({ invocation }) => (
      invocation.command === 'docflow-create' || invocation.command === 'rename'
    ))).toHaveLength(2)
    for (const request of processRequests) {
      expect(request.connectionMaterial).toEqual({
        site: SITE,
        systemUserToken: SYSTEM_USER_TOKEN
      })
      expect(JSON.stringify(request.invocation)).not.toMatch(
        /system-user-token-canary|test1\.edoc2\.com|entrypoint|executable|environment|\benv\b/u
      )
    }
    expect(JSON.stringify({
      nativeRead,
      nativeWrite,
      extendedRead,
      extendedWrite
    }))
      .not.toMatch(/system-user-token-canary|test1\.edoc2\.com|entrypoint|executable|environment/u)
  })

  it('calls the pinned create/read/probe/plan shapes through the receipted canonical facade offline', async () => {
    const commands: string[] = []
    const probeToken = `ocdf_${'r'.repeat(32)}`
    const selection = Object.freeze({
      editTarget: { targetText: 'Old text', occurrence: 1 },
      range: { start: 0, end: 8, unit: 'utf16' },
      oldText: 'Old text'
    })
    const internalServices = inMemoryInternalServices()
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), {
      fetch: providerFetch(),
      skillRuntime: {
        processPort: {
          run: vi.fn(async (request) => {
            const invocation = request.invocation
            commands.push(invocation.command)
            const base = {
              protocol: DOCFLOW_COMMAND_RESULT_PROTOCOL,
              command: invocation.command,
              ok: true as const,
              structuredDeliveryItems: [] as unknown[],
              managedDataFiles: [] as unknown[]
            }
            if (invocation.command === 'docflow-create') {
              return {
                ...base,
                json: { success: true, operation: 'create', fileId: 'created-document' },
                structuredDeliveryItems: [{
                  protocolVersion: '1.0',
                  kind: 'docflowCard',
                  version: 'v1',
                  businessIdentity: 'created-document',
                  outcome: 'succeeded',
                  payload: {
                    projectId: 'created-document',
                    versionId: 'version-created',
                    name: 'Draft.mdoc',
                    versionName: '',
                    accessUrl: 'https://redacted-provider.invalid/',
                    updateTime: '2026-08-20T10:00:00+08:00'
                  }
                }]
              }
            }
            if (invocation.command === 'docflow-read') {
              return {
                ...base,
                json: {
                  success: true,
                  operation: 'read',
                  fileId: invocation.args.fileId,
                  document: {
                    documentHash: invocation.args.fileId === 'created-document'
                      ? NEXT_DOCUMENT_HASH
                      : DOCUMENT_HASH,
                    type: 'doc',
                    children: []
                  }
                }
              }
            }
            if (invocation.command === 'docflow-probe') {
              return {
                ...base,
                json: {
                  success: true,
                  operation: 'probe',
                  view: 'target',
                  fileId: file.fileId,
                  probe: {
                    schemaVersion: 1,
                    fileId: file.fileId,
                    documentHash: DOCUMENT_HASH,
                    summary: {},
                    editContext: {},
                    matches: [selection],
                    index: [],
                    capabilities: { requestedOperation: 'replaceText', supported: true }
                  },
                  truncation: { total: 1, returned: 1, truncated: false }
                },
                managedDataFiles: [{
                  role: 'probe-template',
                  token: probeToken,
                  name: 'probe-template.json',
                  mediaType: 'application/json'
                }]
              }
            }
            if (invocation.command === 'docflow-plan') {
              return {
                ...base,
                json: {
                  success: true,
                  operation: 'plan',
                  fileId: file.fileId,
                  operationId: 'operation-one',
                  operationCount: 1,
                  report: {
                    readOnly: true,
                    canApply: true,
                    baseDocumentHash: DOCUMENT_HASH,
                    resultDocumentHash: NEXT_DOCUMENT_HASH
                  }
                }
              }
            }
            throw new Error(`Unexpected offline native command: ${invocation.command}`)
          })
        }
      }
    })
    const native = requiredNativeFeature(composedProvider(internalServices))
    const signal = new AbortController().signal
    const created = await native.execute(nativeInput({
      effect: 'external-write',
      signal,
      invocationId: 'invocation_offline_create_0001',
      operation: 'create',
      request: {
        operation: 'create',
        resourceType: 'native_document',
        parent: root,
        title: 'Draft',
        content: { encoding: 'json', value: { type: 'doc', children: [] } }
      },
      primary: root
    }))
    const read = await native.execute(nativeInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_offline_read_0001',
      operation: 'read',
      request: { operation: 'read', document },
      primary: file
    }))
    const probe = await native.execute(nativeInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_offline_probe_0001',
      operation: 'probe',
      request: {
        operation: 'probe',
        document,
        selector: { kind: 'text', text: 'Old text', occurrence: 1 },
        requestedCapability: 'replace_text'
      },
      primary: file
    }))
    if (probe.outcome !== 'succeeded' || probe.result.kind !== 'probe') {
      throw new Error('The receipted offline probe did not succeed.')
    }
    const plan = await native.execute(nativeInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_offline_plan_0001',
      operation: 'plan',
      request: {
        operation: 'plan',
        document,
        probeReceiptId: probe.result.probeReceiptId,
        baseHash: DOCUMENT_HASH,
        changes: [{
          kind: 'replace_text',
          target: { kind: 'text', text: 'Old text', occurrence: 1 },
          value: 'New text'
        }]
      },
      primary: file
    }))

    expect(created).toMatchObject({
      outcome: 'succeeded',
      result: { kind: 'document', documentHash: NEXT_DOCUMENT_HASH }
    })
    expect(read).toMatchObject({
      outcome: 'succeeded',
      result: { kind: 'content', documentHash: DOCUMENT_HASH }
    })
    expect(plan).toMatchObject({
      outcome: 'succeeded',
      result: { kind: 'plan', baseHash: DOCUMENT_HASH, changeCount: 1 }
    })
    expect(commands).toEqual([
      'docflow-create',
      'docflow-read',
      'docflow-read',
      'docflow-probe',
      'docflow-plan'
    ])
  })

  it('fails closed before transport when another Provider Instance is selected', async () => {
    const internalServices = inMemoryInternalServices()
    const processRun = vi.fn()
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), {
      fetch: providerFetch(),
      skillRuntime: {
        processPort: { run: processRun }
      }
    })
    const native = requiredNativeFeature(composedProvider(internalServices))

    await expect(native.execute(nativeInput({
      effect: 'read',
      signal: new AbortController().signal,
      invocationId: 'invocation_wrong_provider_0001',
      operation: 'read',
      request: { operation: 'read', document },
      primary: file,
      contextProviderInstanceRef: 'another-provider-instance'
    }))).rejects.toMatchObject({ detail: { code: 'invalid_input' } })
    expect(processRun).not.toHaveBeenCalled()
  })

  it('stops ordinary, CLI, Team, and Project business calls when the expected binding is stale', async () => {
    const businessRequests: string[] = []
    const internalServices = inMemoryInternalServices()
    const processRun = vi.fn()
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), {
      fetch: providerFetch(businessRequests),
      skillRuntime: { processPort: { run: processRun } }
    })
    const provider = composedProvider(internalServices)
    const signal = new AbortController().signal
    const context = {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      expectedExternalBinding: staleExternalBinding,
      invocationId: 'invocation_stale_binding_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    }

    await expect(provider.listContainers({ context, page: { limit: 20 } }))
      .rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    await expect(requiredNativeFeature(provider).execute(nativeInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_stale_binding_0002',
      operation: 'read',
      request: { operation: 'read', document },
      primary: file,
      expectedExternalBinding: staleExternalBinding
    }))).resolves.toMatchObject({ outcome: 'failed', error: { code: 'unauthorized' } })
    await expect(requiredExtendedFeature(provider).execute(extendedInput({
      effect: 'read',
      signal,
      invocationId: 'invocation_stale_binding_0003',
      operation: 'getEntryInfo',
      request: { reference: file },
      expectedExternalBinding: staleExternalBinding
    }))).resolves.toMatchObject({ ok: false, error: { code: 'unauthorized' } })

    const binding = await provider.features!.administration!.bind(context)
    await expect(binding.administration.listSpaces({ page: { limit: 10 } }))
      .rejects.toMatchObject({ detail: { code: 'unauthorized' } })
    await expect(binding.projectProvisioning!.provisionProjectContentSpace({
      projectId: 'project-stale-binding',
      projectLabel: 'Stale binding project',
      contentOwnerUserId: principal.subject,
      contentMemberUserIds: [],
      intentRevision: 1,
      idempotencyKey: 'idem_project.stale-binding.0001'
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(processRun).not.toHaveBeenCalled()
    expect(businessRequests).toEqual([])
  })

  it('blocks a hash-bound write before any DocFlow process invocation', async () => {
    const internalServices = inMemoryInternalServices()
    const processRun = vi.fn()
    const assertPrincipalCurrent = vi.fn(async () => undefined)
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), {
      fetch: providerFetch(),
      skillRuntime: {
        processPort: { run: processRun }
      }
    })
    const native = requiredNativeFeature(composedProvider(internalServices))

    const receipt = await native.execute(nativeInput({
      effect: 'external-write',
      signal: new AbortController().signal,
      invocationId: 'invocation_principal_drift_write_0001',
      operation: 'update',
      request: {
        operation: 'update',
        document,
        baseHash: DOCUMENT_HASH,
        content: { encoding: 'json', value: { type: 'doc', children: [] } }
      },
      primary: file,
      assertPrincipalCurrent
    }))

    expect(receipt).toMatchObject({
      outcome: 'failed',
      error: { code: 'unsupported', retry: 'never' }
    })
    expect(processRun).not.toHaveBeenCalled()
    expect(assertPrincipalCurrent).toHaveBeenCalled()
  })

  it('routes searched OpenContent directory identities to all Team roles and ownership', async () => {
    const internalServices = inMemoryInternalServices()
    const governanceFetch = providerGovernanceFetch()
    const processCommands: string[] = []
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), {
      fetch: governanceFetch.fetch,
      skillRuntime: {
        processPort: {
          run: async (request) => {
            processCommands.push(request.invocation.command)
            const invocation = request.invocation
            if (invocation.command !== 'search-user') {
              throw new Error(`Unexpected Team integration command: ${invocation.command}`)
            }
            return {
              protocol: OPENCONTENT_CLI_RESULT_PROTOCOL,
              invocationId: invocation.invocationId,
              command: invocation.command,
              attemptCount: 1,
              outcome: 'succeeded',
              json: {
                success: true,
                data: {
                  items: [{ identityId: '84', name: 'Ada', account: 'ada' }]
                }
              },
              structuredDeliveryItems: [],
              managedDataFiles: []
            }
          }
        }
      }
    })
    const extended = requiredExtendedFeature(composedProvider(internalServices))
    const signal = new AbortController().signal
    const searched = await extended.execute(directorySearchInput(signal))
    const member = searchedDirectoryUser(searched)

    for (const [index, role] of (['manager', 'internal', 'external'] as const).entries()) {
      await expect(extended.execute(teamGovernanceInput({
        signal,
        invocationId: `invocation_team_role_000${index + 1}`,
        operation: 'updateTeamMemberRole',
        request: { teamRoot: root, member, role }
      }))).resolves.toMatchObject({ ok: true, value: { role } })
    }

    const newOwner = Object.freeze({
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      kind: 'user' as const,
      principalId: '91'
    })
    await expect(extended.execute(teamGovernanceInput({
      signal,
      invocationId: 'invocation_team_owner_0001',
      operation: 'transferTeamOwnership',
      request: { teamRoot: root, newOwner }
    }))).resolves.toMatchObject({
      ok: true,
      value: { owner: newOwner }
    })

    expect(governanceFetch.observedUserTypes).toEqual([2, 3, 4])
    expect(governanceFetch.observedOwnerIdentityIds).toEqual([91])
    expect(processCommands).toEqual(['search-user'])

    const callsBeforeInvalidIdentity = governanceFetch.requestCount()
    await expect(extended.execute(teamGovernanceInput({
      signal,
      invocationId: 'invocation_team_invalid_identity_0001',
      operation: 'updateTeamMemberRole',
      request: {
        teamRoot: root,
        member: { ...member, principalId: '084' },
        role: 'internal'
      }
    }))).resolves.toMatchObject({ ok: false, error: { code: 'invalid_reference' } })
    expect(governanceFetch.requestCount()).toBe(callsBeforeInvalidIdentity)
    expect(governanceFetch.observedUserTypes).toEqual([2, 3, 4])
  })

  it('routes a searched Provider directory user through canonical Team membership administration', async () => {
    const internalServices = inMemoryInternalServices()
    const governanceFetch = providerGovernanceFetch()
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), {
      fetch: governanceFetch.fetch,
      skillRuntime: {
        processPort: {
          run: async (request) => {
            const invocation = request.invocation
            if (invocation.command !== 'search-user') {
              throw new Error(`Unexpected Team integration command: ${invocation.command}`)
            }
            return {
              protocol: OPENCONTENT_CLI_RESULT_PROTOCOL,
              invocationId: invocation.invocationId,
              command: invocation.command,
              attemptCount: 1,
              outcome: 'succeeded',
              json: {
                success: true,
                data: {
                  items: [{ identityId: '85', name: 'Grace', account: 'grace' }]
                }
              },
              structuredDeliveryItems: [],
              managedDataFiles: []
            }
          }
        }
      }
    })
    const provider = composedProvider(internalServices)
    const signal = new AbortController().signal
    const searched = await requiredExtendedFeature(provider).execute(directorySearchInput(signal))
    const member = searchedDirectoryUser(searched)
    const feature = provider.features?.administration
    if (!feature) throw new Error('Composed OpenContent administration feature is unavailable.')
    const { administration } = await feature.bind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_team_member_admin_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    })
    const spaces = await administration.listSpaces({ page: { limit: 10 } })
    const space = spaces.items[0]
    if (!space) throw new Error('The composed OpenContent Team fixture is unavailable.')

    await expect(administration.addMember({
      root: space.root,
      member,
      expectedRevision: space.revision
    })).resolves.toMatchObject({ member, role: 'internal' })
    const listed = await administration.listMembers({
      root: space.root,
      page: { limit: 10 }
    })
    const listedMember = listed.items.find((item) => item.member.principalId === '85')
    expect(listedMember).toMatchObject({ member, role: 'internal' })
    if (!listedMember) throw new Error('The added Provider directory member was not listed.')

    await expect(administration.removeMember({
      root: space.root,
      member: listedMember.member,
      expectedRevision: space.revision
    })).resolves.toMatchObject({ member, removed: true })
    await expect(administration.listMembers({
      root: space.root,
      page: { limit: 10 }
    })).resolves.not.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ member })])
    })
    expect(governanceFetch.observedAddedIdentityIds).toEqual([85])
    expect(governanceFetch.observedRemovedIdentityIds).toEqual([85])
  })

  it('lists Team members from the actual teamUser collection without pagination metadata', async () => {
    const internalServices = inMemoryInternalServices()
    const fallbackFetch = providerFetch()
    const fetch = vi.fn<typeof globalThis.fetch>(async (rawUrl, init) => {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
      if (url.pathname.endsWith('/Team/GetTeamById')) {
        return jsonResponse({ result: 0, data: providerTeam(42) })
      }
      if (url.pathname.endsWith('/Team/GetTeamUserByTeamIdPaging')) {
        return jsonResponse({
          result: 0,
          data: {
            creatorName: 'Synthetic Owner',
            perm: true,
            teamUser: [{
              identityId: 42,
              userType: 1,
              displayName: 'Synthetic Owner'
            }]
          }
        })
      }
      return fallbackFetch(rawUrl, init)
    })
    createConnectorMainEntry(connectorHost(internalServices, connectionSettings()), { fetch })
    const provider = composedProvider(internalServices)
    const feature = provider.features?.administration
    if (!feature) throw new Error('Composed OpenContent administration feature is unavailable.')
    const signal = new AbortController().signal
    const { administration } = await feature.bind({
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_team_member_collection_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    })
    const teamRoot = toPortableContentContainerReference(root)

    await expect(administration.listMembers({
      root: teamRoot,
      page: { limit: 10 }
    })).resolves.toMatchObject({
      root: teamRoot,
      items: [{
        member: {
          providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
          kind: 'user',
          principalId: '42'
        },
        role: 'owner'
      }]
    })
  })
})

function createAssetFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'sciforge-composed-runtime-assets-'))
  const repositoryRoot = resolve(root, 'repository')
  const assetRoot = resolve(
    repositoryRoot,
    'internal/opencontent/packages/opencontent-skill-assets/assets/opencontent-base-1.0.1'
  )
  for (const relativePath of [
    'cli/bin/oc.js',
    'cli/docflow/docflow-node.cjs',
    'scripts/docflow-probe-compact.cjs',
    'package.json',
    'runtime-patches/cli-auth-retry-single-attempt.v1.json'
  ]) {
    const target = resolve(assetRoot, ...relativePath.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, relativePath.endsWith('.json') ? '{}\n' : 'module.exports = {}\n', {
      mode: 0o644
    })
  }
  writeOverlayReceipt(repositoryRoot)
  return {
    repositoryRoot,
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}

function writeOverlayReceipt(repositoryRoot: string): void {
  const overlayId = 'opencontent-attachment-assets'
  const overlayRoot = 'internal/opencontent'
  const version = '1.0.1'
  const files = createStaticFileInventory({
    label: 'OpenContent Provider composed runtime fixture',
    rootPath: resolve(repositoryRoot, overlayRoot),
    rootPrefix: overlayRoot
  })
  const receiptPath = resolve(
    repositoryRoot,
    `.sciforge/internal-overlays/${overlayId}.json`
  )
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, canonicalJson({
    archiveRoot: `sciforge-internal-overlay-${overlayId}-${version}`,
    archiveSha256: OPENCONTENT_SKILL_BUNDLED_ASSET_DESCRIPTOR.installation.archiveSha256,
    files,
    inventorySha256: digestInventory({ files, overlayId, overlayRoot, version }),
    overlayId,
    overlayRoot,
    schemaVersion: 2,
    version
  }), { mode: 0o644 })
}

function nativeInput(input: Readonly<{
  effect: 'read' | 'external-write'
  signal: AbortSignal
  invocationId: string
  operation: 'read' | 'create' | 'probe' | 'plan' | 'update'
  request: unknown
  primary: typeof root | typeof file
  contextProviderInstanceRef?: string
  assertPrincipalCurrent?: () => void | Promise<void>
  expectedExternalBinding?: typeof staleExternalBinding
}>): Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0] {
  return {
    effect: input.effect,
    context: {
      principal,
      providerInstanceRef: input.contextProviderInstanceRef ?? OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: input.invocationId,
      deadlineAt: DEADLINE,
      signal: input.signal,
      ...(input.expectedExternalBinding === undefined
        ? {}
        : { expectedExternalBinding: input.expectedExternalBinding }),
      assertPrincipalCurrent: input.assertPrincipalCurrent ?? (() => undefined)
    },
    target: {
      kind: 'content',
      root,
      primary: input.primary,
      authorized: [input.primary]
    },
    operation: input.operation,
    request: input.request
  }
}

function extendedInput(input: Readonly<{
  effect: 'read' | 'external-write'
  signal: AbortSignal
  invocationId: string
  operation: 'getEntryInfo' | 'renameEntry'
  request: unknown
  expectedExternalBinding?: typeof staleExternalBinding
}>): Parameters<ContentSpaceExtendedOperationsExecutor['execute']>[0] {
  return {
    effect: input.effect,
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: input.invocationId,
      deadlineAt: DEADLINE,
      signal: input.signal,
      ...(input.expectedExternalBinding === undefined
        ? {}
        : { expectedExternalBinding: input.expectedExternalBinding }),
      assertPrincipalCurrent: () => undefined
    },
    target: { kind: 'content', root, primary: file, authorized: [file] },
    operation: input.operation,
    request: input.request
  }
}

function directorySearchInput(
  signal: AbortSignal
): Parameters<ContentSpaceExtendedOperationsExecutor['execute']>[0] {
  return {
    effect: 'read',
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: 'invocation_directory_search_0001',
      deadlineAt: DEADLINE,
      signal,
      assertPrincipalCurrent: () => undefined
    },
    target: {
      kind: 'provider-administration',
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF
    },
    operation: 'searchUsers',
    request: {
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      query: 'Ada',
      page: { limit: 10 }
    }
  }
}

function teamGovernanceInput(input: Readonly<{
  signal: AbortSignal
  invocationId: string
  operation: 'updateTeamMemberRole' | 'transferTeamOwnership'
  request: unknown
}>): Parameters<ContentSpaceExtendedOperationsExecutor['execute']>[0] {
  return {
    effect: 'external-write',
    context: {
      principal,
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      invocationId: input.invocationId,
      deadlineAt: DEADLINE,
      signal: input.signal,
      assertPrincipalCurrent: () => undefined
    },
    target: { kind: 'content', root, primary: root, authorized: [root] },
    operation: input.operation,
    request: input.request
  }
}

function searchedDirectoryUser(value: unknown): Readonly<{
  providerInstanceRef: typeof OPENCONTENT_PROVIDER_INSTANCE_REF
  kind: 'user'
  principalId: string
}> {
  if (typeof value !== 'object' || value === null || !('ok' in value) || value.ok !== true ||
    !('value' in value) || typeof value.value !== 'object' || value.value === null ||
    !('items' in value.value) || !Array.isArray(value.value.items)) {
    throw new Error('OpenContent directory search did not return a page.')
  }
  const first = value.value.items[0]
  if (typeof first !== 'object' || first === null || !('reference' in first) ||
    typeof first.reference !== 'object' || first.reference === null ||
    !('providerInstanceRef' in first.reference) ||
    first.reference.providerInstanceRef !== OPENCONTENT_PROVIDER_INSTANCE_REF ||
    !('kind' in first.reference) || first.reference.kind !== 'user' ||
    !('principalId' in first.reference) || typeof first.reference.principalId !== 'string') {
    throw new Error('OpenContent directory search did not return a canonical user reference.')
  }
  return Object.freeze({
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    kind: 'user',
    principalId: first.reference.principalId
  })
}

function requiredNativeFeature(provider: ContentSpaceProvider): ContentSpaceNativeDocumentExecutor {
  const feature = provider.features?.nativeDocuments
  if (!feature) throw new Error('Composed OpenContent native-document feature is unavailable.')
  return feature
}

function requiredExtendedFeature(
  provider: ContentSpaceProvider
): ContentSpaceExtendedOperationsExecutor {
  const feature = provider.features?.extendedOperations
  if (!feature) throw new Error('Composed OpenContent extended-operation feature is unavailable.')
  return feature
}

function privateProcessRequest(value: unknown): Readonly<{
  invocation: Readonly<{ command: string }>
  connectionMaterial: Readonly<{ site: string; systemUserToken: string }>
}> {
  if (typeof value !== 'object' || value === null ||
    !('invocation' in value) || typeof value.invocation !== 'object' ||
    value.invocation === null || !('command' in value.invocation) ||
    typeof value.invocation.command !== 'string' ||
    !('connectionMaterial' in value) || typeof value.connectionMaterial !== 'object' ||
    value.connectionMaterial === null || !('site' in value.connectionMaterial) ||
    typeof value.connectionMaterial.site !== 'string' ||
    !('systemUserToken' in value.connectionMaterial) ||
    typeof value.connectionMaterial.systemUserToken !== 'string') {
    throw new Error('Invalid private process request fixture.')
  }
  return value as Readonly<{
    invocation: Readonly<{ command: string }>
    connectionMaterial: Readonly<{ site: string; systemUserToken: string }>
  }>
}

function composedProvider(
  internalServices: NonNullable<DomainMainHost['internalServices']>
): ContentSpaceProvider {
  const host: DomainMainHost = Object.freeze({
    getUserDataDir: () => '/private/tmp/sciforge-opencontent-provider-test',
    defineCapability: (options: unknown) => options,
    internalServices
  })
  const factory = createProviderMainEntry(host).contributions[0]!.value
  const instance = defineProviderInstanceDirectoryEntry({
    contractVersion: PROVIDER_FACTORY_CONTRACT_VERSION,
    providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
    providerKind: OPENCONTENT_PROVIDER_KIND,
    displayName: 'OpenContent'
  })
  return factory.createProvider({
    owner: Object.freeze({
      packageName: '@sciforge/domain-opencontent-content-space-provider',
      moduleId: 'sciforge.opencontent-content-space-provider',
      moduleVersion: '1.0.0',
      contributionId: 'opencontent-content-space.provider-factory'
    }),
    instance,
    ports: Object.freeze({})
  }) as ContentSpaceProvider
}

function connectorHost(
  internalServices: NonNullable<DomainMainHost['internalServices']>,
  settings: DomainMainPackageSettingsHost
): DomainMainHost {
  const credentials: DomainMainProviderCredentialStoreHost = Object.freeze({
    status: vi.fn(async () => ({ state: 'available' as const, recordVersion: 1 as const })),
    replace: vi.fn(async () => undefined),
    use: async (_access, operation) => operation(SYSTEM_USER_TOKEN),
    remove: vi.fn(async () => undefined)
  })
  return Object.freeze({
    getUserDataDir: () => '/private/tmp/sciforge-opencontent-connector-test',
    getAppRoot: () => assetFixture.repositoryRoot,
    getExecutablePath: () => process.execPath,
    isPackaged: () => false,
    defineCapability: (options: unknown) => options,
    packageSettings: settings,
    packageSecrets: Object.freeze({
      has: vi.fn(async () => false),
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      providerCredentials: credentials
    }),
    internalServices
  })
}

function connectionSettings(): DomainMainPackageSettingsHost {
  const value = {
    version: 1,
    connections: [{
      principal: {
        authority: principal.authority,
        subject: principal.subject,
        assurance: principal.assurance,
        deviceId: principal.deviceId
      },
      providerInstanceRef: OPENCONTENT_PROVIDER_INSTANCE_REF,
      connectionId: 'connection-composed-runtime',
      externalAccount: {
        id: 'external-account-42',
        identityId: 42,
        account: 'content-owner',
        name: 'Content Owner'
      },
      state: 'connected',
      updatedAt: '2026-08-20T00:00:00.000Z'
    }]
  } satisfies DomainPackageJsonValue
  return Object.freeze({
    read: vi.fn(async () => ({ revision: 1, value })),
    write: vi.fn(async (next: DomainPackageJsonValue) => ({ revision: 2, value: next })),
    clear: vi.fn(async () => ({ revision: 2, value: null }))
  })
}

function inMemoryInternalServices(): NonNullable<DomainMainHost['internalServices']> {
  let facade: OpenContentContentSpaceFacade | undefined
  return Object.freeze({
    register: (registration) => {
      facade = registration.service as OpenContentContentSpaceFacade
    },
    acquire: <Service extends object>() => {
      if (!facade) throw new Error('The OpenContent facade has not been registered.')
      return facade as unknown as Service
    }
  })
}

function providerFetch(businessRequests: string[] = []): typeof fetch {
  return vi.fn(async (rawUrl, init) => {
    const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as unknown
    if (url.pathname.endsWith('/Auth/CheckUserTokenValidity')) {
      expect(url.searchParams.get('token')).toBe(SYSTEM_USER_TOKEN)
      return jsonResponse({ result: 0, msg: '', data: true })
    }
    if (url.pathname.endsWith('/User/GetUserInfoByToken')) {
      expect(body).toEqual({ token: SYSTEM_USER_TOKEN })
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 'external-account-42',
          identityId: 42,
          account: 'content-owner',
          name: 'Content Owner',
          topPersonalFolderId: 1001
        }
      })
    }
    if (url.pathname.endsWith('/Team/GetMyTeamList')) {
      businessRequests.push(url.pathname)
      expect(body).toMatchObject({ token: SYSTEM_USER_TOKEN, pageNum: 1, pageSize: 100 })
      return jsonResponse({
        result: 0,
        data: {
          pageNum: 1,
          pageSize: 100,
          totalCount: 1,
          teamList: [{
            teamId: 7,
            folderId: 8,
            teamName: 'Research Team',
            teamStatus: 1,
            teamOwner: 42,
            permission: 1,
            teamType: 2,
            isStick: false
          }]
        }
      })
    }
    if (url.pathname.endsWith('/DocList/GetFolderChildren')) {
      businessRequests.push(url.pathname)
      expect(body).toMatchObject({
        token: SYSTEM_USER_TOKEN,
        fid: root.containerId,
        noCalcPerm: false
      })
      if (typeof body !== 'object' || body === null ||
        !('argsXml' in body) || typeof body.argsXml !== 'string') {
        throw new Error('The create parent postcondition requires bounded folder pagination.')
      }
      const argsXml = decodeURIComponent(body.argsXml)
      expect(argsXml).toContain('<PageNum>1</PageNum>')
      expect(argsXml).toContain('<PageSize>100</PageSize>')
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          folderId: 8,
          thisFolder: { id: 8, folderGuid: root.containerId, permission: 7 },
          docListInfo: {
            foldersInfo: [],
            filesInfo: [{
              id: 10888,
              fileGuid: 'created-document',
              name: 'Draft.mdoc',
              parentFolderId: 8,
              size: 128,
              permission: 7
            }],
            settings: {
              pageNum: 1,
              pageSize: 100,
              totalCount: 1,
              fileCount: 1,
              folderCount: 0
            }
          }
        }
      })
    }
    if (url.pathname.endsWith('/DocList/GetFolderInfoById')) {
      businessRequests.push(url.pathname)
      expect(body).toMatchObject({ token: SYSTEM_USER_TOKEN, folderId: 8 })
      return jsonResponse({
        result: 0,
        data: { id: 8, folderGuid: root.containerId, teamId: 7 }
      })
    }
    throw new Error(`Unexpected OpenContent integration request: ${url.pathname}`)
  }) as typeof fetch
}

function providerGovernanceFetch(): Readonly<{
  fetch: typeof globalThis.fetch
  requestCount(): number
  observedUserTypes: number[]
  observedOwnerIdentityIds: number[]
  observedAddedIdentityIds: number[]
  observedRemovedIdentityIds: number[]
}> {
  const observedUserTypes: number[] = []
  const observedOwnerIdentityIds: number[] = []
  const observedAddedIdentityIds: number[] = []
  const observedRemovedIdentityIds: number[] = []
  const teamUsers = new Map<number, Readonly<{ userType: number; displayName: string }>>([
    [84, Object.freeze({ userType: 3, displayName: 'Ada' })]
  ])
  let currentOwnerIdentityId = 42
  const fetch = vi.fn<typeof globalThis.fetch>(async (rawUrl, init) => {
    const url = new URL(typeof rawUrl === 'string' ? rawUrl : rawUrl.toString())
    const body = jsonBody(init?.body)
    if (url.pathname.endsWith('/Auth/CheckUserTokenValidity')) {
      return jsonResponse({ result: 0, msg: '', data: true })
    }
    if (url.pathname.endsWith('/User/GetUserInfoByToken')) {
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 'external-account-42',
          identityId: 42,
          account: 'content-owner',
          name: 'Content Owner',
          topPersonalFolderId: 1001
        }
      })
    }
    if (url.pathname.endsWith('/Team/GetMyTeamList')) {
      return jsonResponse({
        result: 0,
        data: {
          pageNum: 1,
          pageSize: 100,
          totalCount: 1,
          teamList: [providerTeam(currentOwnerIdentityId)]
        }
      })
    }
    if (url.pathname.endsWith('/DocList/GetFolderInfoById')) {
      return jsonResponse({
        result: 0,
        data: { id: 8, folderGuid: root.containerId, teamId: 7 }
      })
    }
    if (url.pathname.endsWith('/Team/SetTeamUserRole')) {
      const userType = requiredNumberField(body, 'userType')
      observedUserTypes.push(userType)
      const userIds = requiredNumberArrayField(body, 'userIds')
      expect(userIds).toEqual([84])
      teamUsers.set(84, Object.freeze({ userType, displayName: 'Ada' }))
      return jsonResponse({ result: 0 })
    }
    if (url.pathname.endsWith('/Team/GetTeamUserByTeamIdPaging')) {
      const users = [...teamUsers].map(([identityId, user]) => ({
        identityId,
        userType: user.userType,
        displayName: user.displayName
      }))
      return jsonResponse({
        result: 0,
        data: {
          pageNum: 1,
          pageSize: 100,
          totalCount: users.length,
          list: users
        }
      })
    }
    if (url.pathname.endsWith('/Team/SaveTeamUserList')) {
      const additions = requiredRecordArrayField(body, 'addUserInfo')
      const deletions = requiredNumberArrayField(body, 'deleteUserInfo')
      for (const addition of additions) {
        const identityId = requiredNumberField(addition, 'userId')
        const userType = requiredNumberField(addition, 'userType')
        observedAddedIdentityIds.push(identityId)
        teamUsers.set(identityId, Object.freeze({ userType, displayName: `User ${identityId}` }))
      }
      for (const identityId of deletions) {
        observedRemovedIdentityIds.push(identityId)
        teamUsers.delete(identityId)
      }
      return jsonResponse({ result: 0 })
    }
    if (url.pathname.endsWith('/Team/EditTeamOwner')) {
      currentOwnerIdentityId = requiredNumberField(body, 'userId')
      observedOwnerIdentityIds.push(currentOwnerIdentityId)
      return jsonResponse({ result: 0 })
    }
    if (url.pathname.endsWith('/Team/GetTeamById')) {
      return jsonResponse({ result: 0, data: providerTeam(currentOwnerIdentityId) })
    }
    throw new Error(`Unexpected OpenContent Team integration request: ${url.pathname}`)
  })
  return Object.freeze({
    fetch: fetch as typeof globalThis.fetch,
    requestCount: () => fetch.mock.calls.length,
    observedUserTypes,
    observedOwnerIdentityIds,
    observedAddedIdentityIds,
    observedRemovedIdentityIds
  })
}

function providerTeam(ownerIdentityId: number) {
  return {
    teamId: 7,
    folderId: 8,
    teamName: 'Research Team',
    teamStatus: 1,
    teamOwner: ownerIdentityId,
    permission: 1,
    teamType: 2,
    isStick: false
  }
}

function jsonBody(body: BodyInit | null | undefined): unknown {
  return body === undefined || body === null ? undefined : JSON.parse(String(body)) as unknown
}

function requiredNumberField(value: unknown, field: string): number {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected numeric field ${field}.`)
  }
  const candidate = (value as Record<string, unknown>)[field]
  if (typeof candidate !== 'number') throw new Error(`Expected numeric field ${field}.`)
  return candidate
}

function requiredNumberArrayField(value: unknown, field: string): number[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected numeric array field ${field}.`)
  }
  const candidate = (value as Record<string, unknown>)[field]
  if (!Array.isArray(candidate) || candidate.some((item: unknown) => typeof item !== 'number')) {
    throw new Error(`Expected numeric array field ${field}.`)
  }
  return candidate as number[]
}

function requiredRecordArrayField(value: unknown, field: string): Record<string, unknown>[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected object array field ${field}.`)
  }
  const candidate = (value as Record<string, unknown>)[field]
  if (!Array.isArray(candidate) || candidate.some((item: unknown) =>
    typeof item !== 'object' || item === null || Array.isArray(item))) {
    throw new Error(`Expected object array field ${field}.`)
  }
  return candidate as Record<string, unknown>[]
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
