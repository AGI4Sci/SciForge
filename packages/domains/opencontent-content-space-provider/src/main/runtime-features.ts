import { AsyncLocalStorage } from 'node:async_hooks'

import {
  createDocflowNativeDocumentAdapter
} from './docflow-native-document-adapter.js'
import {
  createOpenContentExtendedOperationAdapter,
  type OpenContentCurrentPrincipalPort
} from './extended-operation-adapter.js'
import {
  createNativeDocumentProviderAdapter
} from './native-document-provider-adapter.js'
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
  OpenContentConnectorError
} from '@sciforge/domain-opencontent-connector/contract'
import type {
  OpenContentContentSpaceFacade,
  OpenContentSupplierCommandTransport,
  OpenContentSupplierExecutionContext
} from '@sciforge/domain-opencontent-connector/main-contract'
import { toOpenContentExpectedBinding } from './external-binding.js'

const SESSION_BACKED_OPERATION_KEYS = new Set(['getCurrentPrincipal'])
const CONTRACT_BLOCKED_DIRECTORY_OPERATIONS = new Set([
  'searchUsers',
  'searchDepartments',
  'searchPositions',
  'searchGroups'
])
const MAX_NATIVE_PARENT_POSTCONDITION_PAGES = 10_000
const NATIVE_PARENT_POSTCONDITION_PAGE_SIZE = 100
const CONTRACT_BLOCKED_NATIVE_OPERATIONS = new Set<
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
  'comment-delete',
  'import'
])
const NATIVE_DOCUMENT_OPERATION_STATES = Object.freeze(
  NATIVE_DOCUMENT_OPERATIONS.map((operation) => CONTRACT_BLOCKED_NATIVE_OPERATIONS.has(operation)
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
  'browseKnowledgeCollection'
] as const satisfies readonly (keyof typeof CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS)[])
const EXTENDED_OPERATION_STATES = Object.freeze(
  OPENCONTENT_EXTENDED_OPERATIONS.map((operation) => (
    operation === 'updateFileVersion' || CONTRACT_BLOCKED_DIRECTORY_OPERATIONS.has(operation)
  )
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
const SESSION_BACKED_EXTENDED_OPERATION_STATES = Object.freeze(
  OPENCONTENT_EXTENDED_OPERATIONS.map((operation) => SESSION_BACKED_OPERATION_KEYS.has(operation)
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
  const useSupplierTransport = input.facade.useSupplierTransport

  const activeTransport = new AsyncLocalStorage<OpenContentSupplierCommandTransport>()
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
  const nativeAdapter = createNativeDocumentProviderAdapter({ docflow })

  const nativeDocuments: ContentSpaceNativeDocumentExecutor = Object.freeze({
    describeOperations: (context) => {
      if (context.providerInstanceRef !== input.providerInstanceRef) {
        throw operationError('invalid_input', 'The Provider feature target changed instances.')
      }
      return NATIVE_DOCUMENT_OPERATION_STATES
    },
    execute: async (execution) => {
      const session = featureSessionContext(execution, input.providerInstanceRef)
      if (execution.operation === 'import') return nativeImportBlockedFailure(execution)
      if (!useSupplierTransport) {
        return nativeFeatureFailure(
          execution,
          new OpenContentConnectorError(
            'provider_unavailable',
            'The OpenContent attachment runtime is unavailable.'
          )
        )
      }
      try {
        const receipt = await useSupplierTransport(session, (transport) =>
          activeTransport.run(transport, () => nativeAdapter.execute(execution)))
        if (execution.operation !== 'create' ||
          receipt.outcome !== 'succeeded' ||
          receipt.result.kind !== 'document') return receipt
        try {
          const parent = execution.target.primary
          if (!('containerId' in parent)) throw nativePostconditionUnknown()
          const fileId = receipt.result.document.reference.fileId
          let pageNumber = 1
          for (let pages = 0; pages < MAX_NATIVE_PARENT_POSTCONDITION_PAGES; pages += 1) {
            const page = await input.facade.listFolderEntries({
              principal: session.principal,
              providerInstanceRef: session.providerInstanceRef,
              ...(session.expectedBindingAttestation === undefined
                ? {}
                : { expectedBindingAttestation: session.expectedBindingAttestation }),
              parentFolderGuid: parent.containerId,
              page: pageNumber,
              pageSize: NATIVE_PARENT_POSTCONDITION_PAGE_SIZE,
              signal: session.signal,
              assertPrincipalCurrent: session.assertPrincipalCurrent
            })
            if (page.parentFolderGuid !== parent.containerId ||
              page.entries.length > NATIVE_PARENT_POSTCONDITION_PAGE_SIZE) {
              throw nativePostconditionUnknown()
            }
            if (page.entries.some((entry) =>
              entry.kind === 'file' && entry.fileGuid === fileId)) return receipt
            if (page.nextPage === undefined) throw nativePostconditionUnknown()
            if (!Number.isSafeInteger(page.nextPage) || page.nextPage <= pageNumber) {
              throw nativePostconditionUnknown()
            }
            pageNumber = page.nextPage
          }
          throw nativePostconditionUnknown()
        } catch {
          return nativeFeatureFailure(execution, nativePostconditionUnknown())
        }
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
      return useSupplierTransport
        ? EXTENDED_OPERATION_STATES
        : SESSION_BACKED_EXTENDED_OPERATION_STATES
    },
    execute: async (execution) => {
      const session = featureSessionContext(execution, input.providerInstanceRef)
      const execute = (transport?: OpenContentSupplierCommandTransport) =>
        createOpenContentExtendedOperationAdapter({
          providerInstanceRef: input.providerInstanceRef,
          ...(transport ? { transport } : {}),
          currentPrincipal: createCurrentPrincipalPort({
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
        return SESSION_BACKED_OPERATION_KEYS.has(execution.operation) || !useSupplierTransport
          ? await execute()
          : await useSupplierTransport(session, execute)
      } catch (error) {
        return extendedFeatureFailure(execution.operation, execution.effect, error)
      }
    }
  })

  return Object.freeze({
    ...(useSupplierTransport ? { nativeDocuments } : {}),
    extendedOperations
  })
}

function featureSessionContext(
  execution: Readonly<{ context: ContentSpaceProviderFeatureExecutionContext['context'] }>,
  providerInstanceRef: string
): OpenContentSupplierExecutionContext {
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

function createCurrentPrincipalPort(input: Readonly<{
  facade: OpenContentContentSpaceFacade
  session: OpenContentSupplierExecutionContext
}>): OpenContentCurrentPrincipalPort {
  return Object.freeze({
    currentIdentityId: () => input.facade.useTeamAdministration({
      principal: input.session.principal,
      providerInstanceRef: input.session.providerInstanceRef,
      ...(input.session.expectedBindingAttestation === undefined
        ? {}
        : { expectedBindingAttestation: input.session.expectedBindingAttestation }),
      signal: input.session.signal,
      assertPrincipalCurrent: input.session.assertPrincipalCurrent
    }, async ({ externalIdentityId }) => externalIdentityId)
  })
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

function nativeImportBlockedFailure(
  execution: Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0]
): ContentSpaceProviderNativeDocumentReceipt {
  return Object.freeze({
    contractVersion: NATIVE_DOCUMENT_CONTRACT_VERSION,
    resourceType: NATIVE_DOCUMENT_RESOURCE_TYPE,
    operation: execution.operation,
    invocationId: execution.context.invocationId ?? 'invalid-invocation',
    outcome: 'failed' as const,
    error: Object.freeze({
      code: 'unsupported' as const,
      message: 'OpenContent import is blocked because the pinned snapshot exposes no verifiable source-identity or content postcondition.',
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

function nativePostconditionUnknown(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'outcome_unknown',
    'The created OpenContent document is not proven under its exact parent.'
  )
}

function operationError(
  code: 'invalid_input',
  message: string
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({ code, message, retry: 'never' })
}
