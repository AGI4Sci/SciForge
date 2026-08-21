import { AsyncLocalStorage } from 'node:async_hooks'

import {
  createDocflowNativeDocumentAdapter
} from '@sciforge/opencontent-skill-runtime/main/docflow-native-document-adapter'
import {
  createOpenContentExtendedOperationAdapter,
  type OpenContentTeamGovernancePort
} from '@sciforge/opencontent-skill-runtime/main/extended-operation-adapter'
import {
  createNativeDocumentProviderAdapter
} from '@sciforge/opencontent-skill-runtime/main/native-document-provider-adapter'
import {
  NATIVE_DOCUMENT_CONTRACT_VERSION,
  NATIVE_DOCUMENT_OPERATIONS,
  NATIVE_DOCUMENT_RESOURCE_TYPE,
  nativeDocumentHashSchema
} from '@sciforge/domain-content-space/native-document-contract'
import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS
} from '@sciforge/domain-content-space/extended-operations-contract'
import {
  ContentSpaceOperationError,
  contentSpaceInvocationIdSchema
} from '@sciforge/domain-content-space/contract'
import type {
  ContentSpaceExtendedOperationState,
  ContentSpaceExtendedOperationsExecutor,
  ContentSpaceNativeDocumentExecutor,
  ContentSpaceNativeDocumentOperationState,
  ContentSpaceProviderFeatureExecutionContext,
  ContentSpaceProviderFeatures,
  ContentSpaceProviderNativeDocumentReceipt
} from '@sciforge/domain-content-space/provider-features'
import {
  OpenContentConnectorError,
  type OpenContentContentSpaceFacade,
  type OpenContentSkillRuntimeContext,
  type OpenContentSkillRuntimeTransport
} from '@sciforge/domain-opencontent-connector/contract'
import {
  OPENCONTENT_TEAM_PAGE_SIZE_MAX,
  openContentIdentityIdSchema,
  type OpenContentBoundTeamAdministration,
  type OpenContentIdentityId,
  type OpenContentTeam
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

import { domainPackageDefinition } from '../definition.js'
import { toOpenContentExpectedBinding } from './external-binding.js'

const ADAPTER_OWNER = Object.freeze({
  role: 'adapter-owner' as const,
  moduleId: 'sciforge.opencontent-content-space-provider' as const,
  moduleVersion: domainPackageDefinition.module.version
})
const TEAM_OPERATION_KEYS = new Set(['updateTeamMemberRole', 'transferTeamOwnership'])
const MAX_TEAM_PAGES = 10_000
const NON_ATOMIC_NATIVE_OPERATIONS = new Set<
  (typeof NATIVE_DOCUMENT_OPERATIONS)[number]
>([
  'update',
  'edit',
  'insert',
  'undo',
  'redo',
  'comment-create',
  'comment-reply',
  'comment-solve',
  'comment-reopen',
  'comment-delete'
])
const NATIVE_DOCUMENT_OPERATION_STATES = Object.freeze(
  NATIVE_DOCUMENT_OPERATIONS.map((operation) => NON_ATOMIC_NATIVE_OPERATIONS.has(operation)
    ? Object.freeze({
        operation,
        readiness: 'blocked_by_contract' as const,
        reasonCode: 'provider_contract_missing' as const
      })
    : Object.freeze({
        operation,
        readiness: 'poc_only' as const,
        reasonCode: 'verification_profile_required' as const
      }))
) satisfies readonly ContentSpaceNativeDocumentOperationState[]
const OPENCONTENT_EXTENDED_OPERATIONS = Object.freeze([
  'searchEntries',
  'listRecentEntries',
  'getEntryInfo',
  'resolveInternalLink',
  'buildFileScope',
  'listMetadataTypes',
  'listMetadataFields',
  'listMetadataChoices',
  'readEntryMetadata',
  'editEntryMetadata',
  'renameEntry',
  'copyEntries',
  'moveEntries',
  'deleteEntries',
  'createShortcut',
  'updateEntryProperties',
  'listSecurityLevels',
  'updateFileVersion',
  'exportFileAsPdf',
  'listAttachments',
  'addAttachment',
  'removeAttachment',
  'listRelations',
  'createRelation',
  'removeRelation',
  'listTags',
  'setTags',
  'removeTags',
  'createPublication',
  'listPublications',
  'cancelPublication',
  'createShare',
  'listShares',
  'cancelShare',
  'listAlbums',
  'listAlbumEntries',
  'addFavorite',
  'removeFavorite',
  'getCurrentPrincipal',
  'searchUsers',
  'searchDepartments',
  'searchPositions',
  'searchGroups',
  'listPermissionCategories',
  'listPermissions',
  'changePermissions',
  'listCollaborationEntries',
  'searchCollaborationEntries',
  'resolveCollaborationInvitation',
  'listKnowledgeCollections',
  'searchKnowledgeCollections',
  'browseKnowledgeCollection',
  'updateTeamMemberRole',
  'transferTeamOwnership'
] as const satisfies readonly (keyof typeof CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS)[])
const EXTENDED_OPERATION_STATES = Object.freeze(
  OPENCONTENT_EXTENDED_OPERATIONS.map((operation) => operation === 'updateFileVersion'
    ? Object.freeze({
        operation,
        readiness: 'blocked_by_contract' as const,
        reasonCode: 'provider_contract_missing' as const
      })
    : Object.freeze({
        operation,
        readiness: 'poc_only' as const,
        reasonCode: 'verification_profile_required' as const
      }))
) satisfies readonly ContentSpaceExtendedOperationState[]
const TEAM_ONLY_EXTENDED_OPERATION_STATES = Object.freeze(
  OPENCONTENT_EXTENDED_OPERATIONS.map((operation) => TEAM_OPERATION_KEYS.has(operation)
    ? Object.freeze({
        operation,
        readiness: 'poc_only' as const,
        reasonCode: 'verification_profile_required' as const
      })
    : Object.freeze({
        operation,
        readiness: 'blocked_by_contract' as const,
        reasonCode: 'provider_contract_missing' as const
      }))
) satisfies readonly ContentSpaceExtendedOperationState[]

export function createOpenContentRuntimeFeatures(input: Readonly<{
  providerInstanceRef: string
  facade: OpenContentContentSpaceFacade
}>): Pick<ContentSpaceProviderFeatures, 'nativeDocuments' | 'extendedOperations'> {
  const useSkillRuntime = input.facade.useSkillRuntime

  const activeTransport = new AsyncLocalStorage<OpenContentSkillRuntimeTransport>()
  const docflow = createDocflowNativeDocumentAdapter({
    invoke: (invocation) => {
      const transport = activeTransport.getStore()
      if (!transport) {
        throw new OpenContentConnectorError(
          'unauthorized',
          'The native-document adapter has no active OpenContent session.'
        )
      }
      return transport.invoke(invocation)
    }
  })
  const nativeAdapter = createNativeDocumentProviderAdapter({ owner: ADAPTER_OWNER, docflow })

  const nativeDocuments: ContentSpaceNativeDocumentExecutor = Object.freeze({
    describeOperations: (context) => {
      if (context.providerInstanceRef !== input.providerInstanceRef) {
        throw operationError('invalid_input', 'The Provider feature target changed instances.')
      }
      return NATIVE_DOCUMENT_OPERATION_STATES
    },
    execute: async (execution) => {
      const session = featureSessionContext(execution, input.providerInstanceRef)
      if (!useSkillRuntime) {
        return nativeFeatureFailure(
          execution,
          new OpenContentConnectorError(
            'provider_unavailable',
            'The OpenContent attachment runtime is unavailable.'
          )
        )
      }
      try {
        return await useSkillRuntime(session, (transport) =>
          activeTransport.run(transport, () => nativeAdapter.execute(execution)))
      } catch (error) {
        return nativeFeatureFailure(execution, error)
      }
    }
  })

  const extendedOperations: ContentSpaceExtendedOperationsExecutor = Object.freeze({
    describeOperations: (context) => {
      if (context.providerInstanceRef !== input.providerInstanceRef) {
        throw operationError('invalid_input', 'The Provider feature target changed instances.')
      }
      return useSkillRuntime
        ? EXTENDED_OPERATION_STATES
        : TEAM_ONLY_EXTENDED_OPERATION_STATES
    },
    execute: async (execution) => {
      const session = featureSessionContext(execution, input.providerInstanceRef)
      const execute = (transport?: OpenContentSkillRuntimeTransport) =>
        createOpenContentExtendedOperationAdapter({
          owner: ADAPTER_OWNER,
          providerInstanceRef: input.providerInstanceRef,
          ...(transport ? { transport } : {}),
          teamGovernance: createTeamGovernance({
            facade: input.facade,
            session
          })
        }).execute({
          invocationId: session.invocationId,
          operation: execution.operation,
          request: execution.request,
          ...(execution.source ? { source: execution.source } : {}),
          ...(execution.destination ? { destination: execution.destination } : {})
      })
      try {
        return TEAM_OPERATION_KEYS.has(execution.operation) || !useSkillRuntime
          ? await execute()
          : await useSkillRuntime(session, execute)
      } catch (error) {
        return extendedFeatureFailure(execution.operation, execution.effect, error)
      }
    }
  })

  return Object.freeze({
    ...(useSkillRuntime ? { nativeDocuments } : {}),
    extendedOperations
  })
}

function featureSessionContext(
  execution: Readonly<{ context: ContentSpaceProviderFeatureExecutionContext['context'] }>,
  providerInstanceRef: string
): OpenContentSkillRuntimeContext {
  if (execution.context.providerInstanceRef !== providerInstanceRef) {
    throw operationError('invalid_input', 'The Provider feature target changed instances.')
  }
  const invocationId = contentSpaceInvocationIdSchema.safeParse(execution.context.invocationId)
  if (!invocationId.success || !(execution.context.signal instanceof AbortSignal)) {
    throw operationError('invalid_input', 'A bounded Provider feature invocation is required.')
  }
  return Object.freeze({
    principal: execution.context.principal,
    providerInstanceRef,
    ...toOpenContentExpectedBinding(execution.context),
    invocationId: invocationId.data,
    deadlineAt: execution.context.deadlineAt,
    signal: execution.context.signal,
    // The non-serializable Host lease guard remains bound to this exact
    // Provider invocation and is rechecked by the Connector before every CLI
    // subprocess dispatch.
    assertPrincipalCurrent: execution.context.assertPrincipalCurrent
  })
}

function createTeamGovernance(input: Readonly<{
  facade: OpenContentContentSpaceFacade
  session: OpenContentSkillRuntimeContext
}>): OpenContentTeamGovernancePort {
  const withAdministration = <Value>(
    operation: (session: Readonly<{
      externalIdentityId: OpenContentIdentityId
      administration: OpenContentBoundTeamAdministration
    }>) => Promise<Value>
  ) => input.facade.useTeamAdministration({
    principal: input.session.principal,
    providerInstanceRef: input.session.providerInstanceRef,
    ...(input.session.expectedBindingAttestation === undefined
      ? {}
      : { expectedBindingAttestation: input.session.expectedBindingAttestation }),
    signal: input.session.signal,
    assertPrincipalCurrent: input.session.assertPrincipalCurrent
  }, operation)

  const governance: OpenContentTeamGovernancePort = Object.freeze({
    updateMemberRole: async ({ teamRootId, memberPrincipalId, userType }:
      Parameters<OpenContentTeamGovernancePort['updateMemberRole']>[0]) => {
      const identityId = parseProviderDirectoryIdentity(memberPrincipalId)
      return withAdministration(async (connection) => {
        const team = await resolveTeamByRoot(
          connection.administration,
          teamRootId,
          input.session.signal
        )
        await connection.administration.setTeamUserRole(withSignal(input.session.signal, {
          teamId: team.teamId,
          identityIds: [identityId],
          userType
        }))
        const observedType = await observeTeamUserType(
          connection.administration,
          team.teamId,
          identityId,
          input.session.signal
        )
        if (observedType !== userType) {
          throw featureError(
            'outcome_unknown',
            'OpenContent did not prove the requested Team member role.'
          )
        }
        return Object.freeze({ applied: true as const })
      })
    },
    transferOwnership: async ({ teamRootId, newOwnerPrincipalId }:
      Parameters<OpenContentTeamGovernancePort['transferOwnership']>[0]) => {
      const ownerIdentityId = parseProviderDirectoryIdentity(newOwnerPrincipalId)
      return withAdministration(async (connection) => {
        const team = await resolveTeamByRoot(
          connection.administration,
          teamRootId,
          input.session.signal
        )
        await connection.administration.transferTeamOwner(withSignal(input.session.signal, {
          teamId: team.teamId,
          ownerIdentityId
        }))
        const observed = await connection.administration.observeTeam(withSignal(
          input.session.signal,
          { teamId: team.teamId }
        ))
        if (observed.ownerIdentityId !== ownerIdentityId) {
          throw featureError(
            'outcome_unknown',
            'OpenContent did not prove the requested Team ownership transfer.'
          )
        }
        return Object.freeze({ applied: true as const })
      })
    }
  })
  return governance
}

function parseProviderDirectoryIdentity(value: string): OpenContentIdentityId {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw featureError(
      'invalid_reference',
      'The OpenContent directory Principal identity is not canonical.'
    )
  }
  const parsed = openContentIdentityIdSchema.safeParse(Number(value))
  if (!parsed.success || String(parsed.data) !== value) {
    throw featureError(
      'invalid_reference',
      'The OpenContent directory Principal identity is unavailable.'
    )
  }
  return parsed.data
}

async function resolveTeamByRoot(
  administration: OpenContentBoundTeamAdministration,
  folderGuid: string,
  signal: AbortSignal
): Promise<OpenContentTeam> {
  let pageNumber = 1
  let match: OpenContentTeam | undefined
  for (let pageCount = 0; pageCount < MAX_TEAM_PAGES; pageCount += 1) {
    const page = await administration.listTeams(withSignal(signal, {
      pageNumber,
      pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX
    }))
    for (const team of page.teams) {
      const root = await administration.resolveTeamRoot(withSignal(signal, {
        teamId: team.teamId,
        folderId: team.folderId
      }))
      if (root.folderGuid !== folderGuid) continue
      if (match) {
        throw featureError(
          'provider_contract_violation',
          'OpenContent returned duplicate Teams for one root.'
        )
      }
      match = team
    }
    if (page.nextPage === undefined) {
      if (!match) throw featureError('invalid_reference', 'The OpenContent Team root is unavailable.')
      return match
    }
    if (page.nextPage <= pageNumber) {
      throw featureError('provider_contract_violation', 'OpenContent Team paging did not advance.')
    }
    pageNumber = page.nextPage
  }
  throw featureError('provider_contract_violation', 'OpenContent Team paging exceeded its bound.')
}

async function observeTeamUserType(
  administration: OpenContentBoundTeamAdministration,
  teamId: OpenContentTeam['teamId'],
  identityId: OpenContentIdentityId,
  signal: AbortSignal
): Promise<number | undefined> {
  let pageNumber = 1
  for (let pageCount = 0; pageCount < MAX_TEAM_PAGES; pageCount += 1) {
    const page = await administration.listTeamUsers(withSignal(signal, {
      teamId,
      pageNumber,
      pageSize: OPENCONTENT_TEAM_PAGE_SIZE_MAX
    }))
    const user = page.users.find((candidate) => candidate.identityId === identityId)
    if (user) return user.userType
    if (page.nextPage === undefined) return undefined
    if (page.nextPage <= pageNumber) {
      throw featureError('provider_contract_violation', 'OpenContent Team user paging did not advance.')
    }
    pageNumber = page.nextPage
  }
  throw featureError('provider_contract_violation', 'OpenContent Team user paging exceeded its bound.')
}

function withSignal<Value extends object>(signal: AbortSignal, value: Value): Value & {
  signal: AbortSignal
} {
  return Object.freeze({ ...value, signal })
}

function nativeFeatureFailure(
  execution: Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0],
  error: unknown
): ContentSpaceProviderNativeDocumentReceipt {
  const base = {
    contractVersion: NATIVE_DOCUMENT_CONTRACT_VERSION,
    resourceType: NATIVE_DOCUMENT_RESOURCE_TYPE,
    operation: execution.operation,
    invocationId: execution.context.invocationId ?? 'invalid-invocation'
  } as const
  if (error instanceof OpenContentConnectorError) {
    if (error.code === 'conflict') {
      const expectedHash = nativeExpectedHash(execution.request)
      if (expectedHash === undefined) {
        return Object.freeze({
          ...base,
          outcome: 'failed' as const,
          error: Object.freeze({
            code: 'contract_violation' as const,
            message: 'OpenContent returned a conflict without a verifiable base hash.',
            retry: 'never' as const
          })
        })
      }
      return Object.freeze({
        ...base,
        outcome: 'conflict' as const,
        error: Object.freeze({
          code: 'conflict' as const,
          reason: 'revision_conflict' as const,
          message: 'The OpenContent document changed before this operation.',
          retry: 'never' as const,
          expectedHash
        })
      })
    }
    if (error.code === 'outcome_unknown') {
      return Object.freeze({
        ...base,
        outcome: 'outcome_unknown' as const,
        error: Object.freeze({
          code: 'outcome_unknown' as const,
          stage: 'verify' as const,
          message: 'The OpenContent document outcome cannot be proven.',
          retry: 'never' as const
        })
      })
    }
    const code = error.code === 'unauthorized' || error.code === 'reauthentication_required'
      ? 'unauthorized' as const
      : error.code === 'cancelled'
        ? 'cancelled' as const
        : error.code === 'provider_contract_violation'
          ? 'contract_violation' as const
          : error.code === 'invalid_input' || error.code === 'bounds_exceeded'
            ? 'invalid_input' as const
            : 'provider_unavailable' as const
    return Object.freeze({
      ...base,
      outcome: 'failed' as const,
      error: Object.freeze({
        code,
        message: code === 'unauthorized'
          ? 'Reconnect or authorize the current OpenContent account.'
          : code === 'cancelled'
            ? 'The OpenContent document operation was cancelled.'
            : code === 'contract_violation'
              ? 'OpenContent returned an unsupported document result.'
              : code === 'invalid_input'
                ? 'The OpenContent document request is invalid.'
                : 'The OpenContent document service is unavailable.',
        retry: code === 'unauthorized' || error.code === 'rate_limited'
          ? 'after-human-action' as const
          : 'never' as const
      })
    })
  }
  if (execution.effect !== 'read') {
    return Object.freeze({
      ...base,
      outcome: 'outcome_unknown' as const,
      error: Object.freeze({
        code: 'outcome_unknown' as const,
        stage: 'verify' as const,
        message: 'The OpenContent document outcome cannot be proven.',
        retry: 'never' as const
      })
    })
  }
  return Object.freeze({
    ...base,
    outcome: 'failed' as const,
    error: Object.freeze({
      code: 'provider_unavailable' as const,
      message: 'The OpenContent document service is unavailable.',
      retry: 'never' as const
    })
  })
}

function nativeExpectedHash(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null || !('baseHash' in request)) {
    return undefined
  }
  const parsed = nativeDocumentHashSchema.safeParse(request.baseHash)
  return parsed.success ? parsed.data : undefined
}

function extendedFeatureFailure(
  operation: keyof typeof CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
  effect: ContentSpaceProviderFeatureExecutionContext['effect'],
  error: unknown
): unknown {
  const contract = CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS[operation]
  const connectorCode = error instanceof OpenContentConnectorError ? error.code : undefined
  const code = connectorCode === 'unauthorized' || connectorCode === 'reauthentication_required'
    ? 'unauthorized'
    : connectorCode === 'cancelled'
      ? 'cancelled'
      : connectorCode === 'provider_contract_violation'
        ? 'provider_contract_violation'
        : connectorCode === 'invalid_input'
          ? 'invalid_input'
          : connectorCode === 'conflict'
            ? 'conflict'
            : connectorCode === 'rate_limited'
              ? 'rate_limited'
              : connectorCode === 'bounds_exceeded'
                ? 'bounds_exceeded'
                : connectorCode === 'outcome_unknown' || (connectorCode === undefined && effect !== 'read')
                  ? 'outcome_unknown'
                  : 'provider_unavailable'
  return contract.resultSchema.parse({
    ok: false,
    error: {
      code,
      message: code === 'outcome_unknown'
        ? 'The OpenContent write outcome cannot be proven.'
        : code === 'unauthorized'
          ? 'Reconnect or authorize the current OpenContent account.'
          : 'The OpenContent operation could not be completed.',
      retry: code === 'outcome_unknown'
        ? 'never'
        : code === 'unauthorized' || code === 'rate_limited' || code === 'conflict'
          ? 'after-human-action'
          : 'never'
    }
  })
}

function featureError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

function operationError(
  code: 'invalid_input',
  message: string
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({ code, message, retry: 'never' })
}
