import {
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  contentSpacePageRequestSchema,
  defineContentSpaceProvider,
  type ContentSpaceOperation,
  type ContentSpaceProvider
} from '@sciforge/domain-content-space/contract'
import {
  OpenContentConnectorError,
  type OpenContentContentSpaceFacade
} from '@sciforge/domain-opencontent-connector/contract'

const OPERATIONS = Object.freeze([
  'list-containers',
  'list-entries',
  'observe-entry',
  'create-folder',
  'upload-new',
  'download',
  'portal-target',
  'observe-immutable-version'
] as const satisfies readonly ContentSpaceOperation[])

export function createOpenContentContentSpaceProvider(input: Readonly<{
  providerInstanceRef: string
  facade: OpenContentContentSpaceFacade
}>): ContentSpaceProvider {
  const providerInstanceRef = input.providerInstanceRef
  const blocked = (): never => {
    throw new ContentSpaceOperationError({
      code: 'blocked_by_contract',
      message: 'This OpenContent operation has not passed its exact contract gate.',
      retry: 'never'
    })
  }
  return defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
    describeCapabilities: async (context) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      return OPERATIONS.map((operation) => Object.freeze({
        operation,
        readiness: [
          'list-containers',
          'list-entries',
          'observe-entry',
          'create-folder',
          'upload-new',
          'download'
        ].includes(operation)
          ? 'poc_only' as const
          : 'blocked_by_contract' as const,
        reasonCode: [
          'list-containers',
          'list-entries',
          'observe-entry',
          'create-folder',
          'upload-new',
          'download'
        ].includes(operation)
          ? 'verification_profile_required' as const
          : 'provider_contract_missing' as const
      }))
    },
    listContainers: async ({ context, page: rawPage }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      const page = contentSpacePageRequestSchema.parse(rawPage)
      const teamPage = parseTeamCursor(page.cursor)
      try {
        const result = await input.facade.listRootFolders({
          principal: context.principal,
          teamPage: teamPage ?? 1,
          teamPageSize: Math.min(page.limit, 100),
          includePersonal: teamPage === undefined,
          includeTeams: teamPage !== undefined,
          signal: context.signal,
          assertPrincipalCurrent: () => undefined
        })
        const items = result.roots.map((root) => Object.freeze({
          reference: Object.freeze({
            providerInstanceRef,
            containerId: root.folderGuid
          }),
          scope: root.source === 'personal-root' ? 'personal' as const : 'shared' as const,
          label: root.label
        }))
        if (items.length > page.limit) throw providerFailure('provider_unavailable')
        return Object.freeze({
          providerInstanceRef,
          items: Object.freeze(items),
          ...(teamPage === undefined
            ? { nextCursor: 'teams_1' }
            : result.nextTeamPage
              ? { nextCursor: `teams_${result.nextTeamPage}` }
              : {})
        })
      } catch (error) {
        if (error instanceof ContentSpaceOperationError) throw error
        if (error instanceof OpenContentConnectorError) throw mapConnectorError(error)
        throw providerFailure('provider_unavailable')
      }
    },
    listEntries: async ({ context, parent, page: rawPage }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      if (parent.providerInstanceRef !== providerInstanceRef) throw providerFailure('invalid_input')
      const page = contentSpacePageRequestSchema.parse(rawPage)
      const providerPage = parseEntryCursor(page.cursor)
      try {
        const result = await input.facade.listFolderEntries({
          principal: context.principal,
          parentFolderGuid: parent.containerId,
          page: providerPage,
          pageSize: page.limit,
          signal: context.signal,
          assertPrincipalCurrent: () => undefined
        })
        if (result.parentFolderGuid !== parent.containerId) {
          throw providerFailure('provider_unavailable')
        }
        return Object.freeze({
          parent,
          items: Object.freeze(result.entries.map((entry) => entry.kind === 'container'
            ? Object.freeze({
                kind: 'container' as const,
                reference: Object.freeze({
                  providerInstanceRef,
                  containerId: entry.folderGuid
                }),
                label: entry.label
              })
            : Object.freeze({
                kind: 'file' as const,
                reference: Object.freeze({
                  providerInstanceRef,
                  fileId: entry.fileGuid
                }),
                label: entry.label,
                size: entry.size
              }))),
          ...(result.nextPage ? { nextCursor: `page_${result.nextPage}` } : {})
        })
      } catch (error) {
        if (error instanceof ContentSpaceOperationError) throw error
        if (error instanceof OpenContentConnectorError) throw mapConnectorError(error)
        throw providerFailure('provider_unavailable')
      }
    },
    observeEntry: async ({ context, reference }) => {
      assertInstance(context.providerInstanceRef, providerInstanceRef)
      try {
        const container = 'containerId' in reference
        const observed = await input.facade.observeEntry(container
          ? {
              principal: context.principal,
              kind: 'container',
              resourceGuid: reference.containerId,
              signal: context.signal,
              assertPrincipalCurrent: () => undefined
            }
          : {
              principal: context.principal,
              kind: 'file',
              resourceGuid: reference.fileId,
              signal: context.signal,
              assertPrincipalCurrent: () => undefined
            })
        if (container && observed.kind !== 'container') throw providerFailure('provider_unavailable')
        if (!container && observed.kind !== 'file') throw providerFailure('provider_unavailable')
        const entry = container && observed.kind === 'container'
          ? Object.freeze({ kind: 'container' as const, reference, label: observed.label })
          : !container && observed.kind === 'file'
            ? Object.freeze({
                kind: 'file' as const,
                reference: Object.freeze({
                  providerInstanceRef,
                  fileId: reference.fileId
                }),
                label: observed.label,
                size: observed.size
              })
            : null
        if (!entry) throw providerFailure('provider_unavailable')
        return Object.freeze({
          entry,
          capabilities: OPERATIONS.map((operation) => Object.freeze({
            operation,
            readiness: (operation === 'observe-entry' ||
              (container && ['list-entries', 'create-folder', 'upload-new'].includes(operation)) ||
              (!container && operation === 'download'))
              ? 'poc_only' as const
              : 'blocked_by_contract' as const,
            reasonCode: (operation === 'observe-entry' ||
              (container && ['list-entries', 'create-folder', 'upload-new'].includes(operation)) ||
              (!container && operation === 'download'))
              ? 'verification_profile_required' as const
              : 'provider_contract_missing' as const
          }))
        })
      } catch (error) {
        if (error instanceof ContentSpaceOperationError) throw error
        if (error instanceof OpenContentConnectorError) throw mapConnectorError(error)
        throw providerFailure('provider_unavailable')
      }
    },
    createFolder: async ({ context, parent, name }) => {
      try {
        const created = await input.facade.createFolder({
          principal: context.principal,
          parentFolderGuid: parent.containerId,
          name,
          signal: context.signal,
          assertPrincipalCurrent: () => undefined
        })
        return Object.freeze({
          invocationId: context.invocationId,
          parent,
          name,
          reference: Object.freeze({
            providerInstanceRef,
            containerId: created.folderGuid
          })
        })
      } catch (error) {
        throw mapProviderError(error)
      }
    },
    uploadNewFile: async ({ context, parent, name, source }) => {
      try {
        const uploaded = await input.facade.uploadNewFile({
          principal: context.principal,
          parentFolderGuid: parent.containerId,
          name,
          size: source.size,
          read: source.read,
          signal: context.signal,
          assertPrincipalCurrent: () => undefined
        })
        return Object.freeze({
          invocationId: context.invocationId,
          parent,
          name,
          sourceSize: source.size,
          reference: Object.freeze({
            providerInstanceRef,
            fileId: uploaded.fileGuid
          })
        })
      } catch (error) {
        throw mapProviderError(error)
      }
    },
    downloadFile: async ({ context, reference, destination }) => {
      try {
        const downloaded = await input.facade.downloadFile({
          principal: context.principal,
          fileGuid: reference.fileId,
          write: destination.write,
          signal: context.signal,
          assertPrincipalCurrent: () => undefined
        })
        return Object.freeze({
          invocationId: context.invocationId,
          reference,
          bytesWritten: downloaded.bytesWritten
        })
      } catch (error) {
        throw mapProviderError(error)
      }
    },
    resolvePortalTarget: async () => blocked(),
    observeImmutableVersion: async () => blocked()
  })
}

function parseTeamCursor(cursor?: string): number | undefined {
  if (cursor === undefined) return undefined
  const match = /^teams_([1-9]\d*)$/u.exec(cursor)
  const page = match ? Number(match[1]) : Number.NaN
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
    throw providerFailure('invalid_input')
  }
  return page
}

function parseEntryCursor(cursor?: string): number {
  if (cursor === undefined) return 1
  const match = /^page_([1-9]\d*)$/u.exec(cursor)
  const page = match ? Number(match[1]) : Number.NaN
  if (!Number.isSafeInteger(page) || page < 2 || page > 100_000) {
    throw providerFailure('invalid_input')
  }
  return page
}

function assertInstance(actual: string, expected: string): void {
  if (actual !== expected) throw providerFailure('provider_unavailable')
}

function mapConnectorError(error: OpenContentConnectorError): ContentSpaceOperationError {
  if (error.code === 'unauthorized' || error.code === 'reauthentication_required') {
    return new ContentSpaceOperationError({
      code: 'unauthorized',
      message: error.code === 'reauthentication_required'
        ? 'Reconnect the current Local Account to OpenContent.'
        : 'The current OpenContent account is not authorized.',
      retry: 'after-human-action'
    })
  }
  if (error.code === 'cancelled') {
    return new ContentSpaceOperationError({
      code: 'cancelled',
      message: 'The OpenContent operation was cancelled.',
      retry: 'never'
    })
  }
  if (error.code === 'rate_limited') {
    return new ContentSpaceOperationError({
      code: 'rate_limited',
      message: 'OpenContent temporarily rate-limited this operation.',
      retry: 'after-human-action'
    })
  }
  if (error.code === 'provider_contract_violation') {
    return new ContentSpaceOperationError({
      code: 'provider_contract_violation',
      message: 'OpenContent returned an unsupported response contract.',
      retry: 'never'
    })
  }
  if (error.code === 'conflict') {
    return new ContentSpaceOperationError({
      code: 'conflict',
      message: 'An OpenContent entry with this name already exists.',
      retry: 'after-human-action'
    })
  }
  if (error.code === 'outcome_unknown') {
    return new ContentSpaceOperationError({
      code: 'outcome_unknown',
      message: 'The OpenContent write outcome cannot be proven.',
      retry: 'never'
    })
  }
  if (error.code === 'bounds_exceeded') {
    return new ContentSpaceOperationError({
      code: 'bounds_exceeded',
      message: 'The OpenContent transfer exceeds the configured bounds.',
      retry: 'never'
    })
  }
  return providerFailure('provider_unavailable')
}

function mapProviderError(error: unknown): ContentSpaceOperationError {
  if (error instanceof ContentSpaceOperationError) return error
  if (error instanceof OpenContentConnectorError) return mapConnectorError(error)
  return providerFailure('provider_unavailable')
}

function providerFailure(
  code: 'invalid_input' | 'provider_unavailable'
): ContentSpaceOperationError {
  return new ContentSpaceOperationError({
    code,
    message: code === 'invalid_input'
      ? 'The OpenContent page request is invalid.'
      : 'The OpenContent Provider result is unavailable.',
    retry: 'never'
  })
}
