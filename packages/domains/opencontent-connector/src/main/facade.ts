import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

import {
  OpenContentConnectorError
} from '../contract.js'
import type { OpenContentContentSpaceFacade } from '../main-contract.js'
import {
  openContentIdentityIdSchema,
  type OpenContentBoundTeamAdministration,
  type OpenContentIdentityId
} from '../team-administration-contract.js'
import {
  assertOpenContentPrincipalCurrent,
  type OpenContentConnectionService
} from './connection-service.js'
import {
  bindOpenContentTeamAdministration,
} from './team-administration.js'
import {
  requireOpenContentDeploymentRuntime,
  type OpenContentDeploymentRuntimeGetter
} from './runtime.js'
import { assertNoOpenContentSessionTokenEcho } from './session-material-guard.js'

type OpenContentRootFolder = Awaited<ReturnType<
  OpenContentContentSpaceFacade['listRootFolders']
>>['roots'][number]

export function createOpenContentContentSpaceFacade(options: Readonly<{
  providerInstanceRef: string
  connections: OpenContentConnectionService
  getRuntime: OpenContentDeploymentRuntimeGetter
}>): OpenContentContentSpaceFacade {
  const installedProviderInstanceRef = providerInstanceRefSchema.parse(
    options.providerInstanceRef
  )
  const requireRuntime = (providerInstanceRef: string) => {
    if (providerInstanceRef !== installedProviderInstanceRef) {
      throw new OpenContentConnectorError(
        'invalid_input',
        'The selected OpenContent Provider Instance is not installed.'
      )
    }
    return requireOpenContentDeploymentRuntime(options.getRuntime)
  }
  const useRuntimeSession = async <T>(
    input: Parameters<OpenContentContentSpaceFacade['useTeamAdministration']>[0],
    operation: (
      runtime: NonNullable<ReturnType<OpenContentDeploymentRuntimeGetter>>,
      token: string
    ) => T | Promise<T>
  ): Promise<T> => {
    const runtime = requireRuntime(input.providerInstanceRef)
    return options.connections.useCurrentSession({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      expectedBindingAttestation: input.expectedBindingAttestation,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, ({ token }) => operation(runtime, token))
  }
  const useBoundTeamSession = async <T>(
    input: Parameters<OpenContentContentSpaceFacade['useTeamAdministration']>[0],
    operation: (session: Readonly<{
      token: string
      externalIdentityId: OpenContentIdentityId
      administration: OpenContentBoundTeamAdministration
      assertSessionCurrent(): Promise<void>
    }>) => T | Promise<T>
  ): Promise<T> => {
    const runtime = requireRuntime(input.providerInstanceRef)
    const assertPrincipalCurrent = () =>
      assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
    return options.connections.useCurrentSession({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      expectedBindingAttestation: input.expectedBindingAttestation,
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
        runtime.teamAdministration,
        token,
        assertSessionCurrent
      )
      try {
        return await operation(Object.freeze({
          token,
          externalIdentityId: externalIdentityId.data,
          administration,
          assertSessionCurrent
        }))
      } finally {
        active = false
      }
    })
  }

  const useHierarchyProofSession: OpenContentContentSpaceFacade['useHierarchyProofSession'] =
    async (input, operation) => {
      const runtime = requireRuntime(input.providerInstanceRef)
      const assertPrincipalCurrent = () =>
        assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
      return options.connections.useCurrentSession({
        principal: input.principal,
        providerInstanceRef: input.providerInstanceRef,
        expectedBindingAttestation: input.expectedBindingAttestation,
        assertPrincipalCurrent,
        signal: input.signal
      }, async ({ token, bindingAttestation }) => {
        let active = true
        const assertSessionCurrent = async (): Promise<void> => {
          if (!active) {
            throw new OpenContentConnectorError(
              'unauthorized',
              'The verified OpenContent hierarchy proof session has expired.'
            )
          }
          await assertPrincipalCurrent()
        }
        try {
          return await operation(Object.freeze({
            bindingAttestation,
            observeContainer: async ({ resourceGuid }) => {
              await assertSessionCurrent()
              const observed = await runtime.client.observeEntry({
                token,
                kind: 'container',
                resourceGuid,
                signal: input.signal,
                assertPrincipalCurrent: assertSessionCurrent
              })
              await assertSessionCurrent()
              if (observed.kind !== 'container') {
                throw new OpenContentConnectorError(
                  'provider_contract_violation',
                  'OpenContent returned the wrong hierarchy root kind.'
                )
              }
              return observed
            },
            observeEntryParent: async ({ kind, resourceGuid }) => {
              await assertSessionCurrent()
              const fact = await runtime.client.observeEntryParent({
                token,
                kind,
                resourceGuid,
                signal: input.signal,
                assertPrincipalCurrent: assertSessionCurrent
              })
              await assertSessionCurrent()
              return fact
            }
          }))
        } finally {
          active = false
        }
      })
    }

  const supplierRuntime = options.getRuntime()?.supplierRuntime
  return Object.freeze({
    attestExternalBinding: async (input) => {
      requireRuntime(input.providerInstanceRef)
      return options.connections.attestExternalBinding({
        principal: input.principal,
        providerInstanceRef: input.providerInstanceRef,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
    },
    ...(supplierRuntime
      ? { useSupplierTransport: supplierRuntime.useSupplierTransport }
      : {}),
    useTeamAdministration: (input, operation) => useBoundTeamSession(
      input,
      ({ externalIdentityId, administration }) => operation(Object.freeze({
        externalIdentityId,
        administration
      }))
    ),
    useHierarchyProofSession,
    listRootFolders: (input) => useBoundTeamSession(input, async ({
      token,
      administration,
      assertSessionCurrent
    }) => {
      const [personalRoot, teamPage] = await Promise.all([
        input.includePersonal === false
          ? Promise.resolve(undefined)
          : requireRuntime(input.providerInstanceRef).client.listPersonalRootFolder({
              token,
              signal: input.signal,
              assertPrincipalCurrent: assertSessionCurrent
            }),
        input.includeTeams === false
          ? Promise.resolve(undefined)
          : administration.listTeams({
              pageNumber: input.teamPage,
              pageSize: input.teamPageSize,
              signal: input.signal
            })
      ])
      const teamRoots = await Promise.all((teamPage?.teams ?? []).map(async (team) => {
        const root = await administration.resolveTeamRoot({
          teamId: team.teamId,
          folderId: team.folderId,
          signal: input.signal
        })
        return Object.freeze({
          source: 'team-root' as const,
          folderGuid: root.folderGuid,
          label: team.name
        })
      }))
      const roots: OpenContentRootFolder[] = [
        ...(personalRoot === undefined ? [] : [personalRoot]),
        ...teamRoots
      ]
      return Object.freeze({
        roots: Object.freeze(roots),
        ...(teamPage?.nextPage === undefined
          ? {}
          : { nextTeamPage: teamPage.nextPage })
      })
    }),
    listFolderEntries: (input) => useRuntimeSession(input, (runtime, token) =>
      runtime.client.listFolderEntries({
        token,
        parentFolderGuid: input.parentFolderGuid,
        page: input.page,
        pageSize: input.pageSize,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })),
    observeEntry: (input) => useRuntimeSession(input, (runtime, token) =>
      runtime.client.observeEntry({
        token,
        kind: input.kind,
        resourceGuid: input.resourceGuid,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })),
    createFolder: (input) => useRuntimeSession(input, (runtime, token) =>
      runtime.client.createFolder({
        token,
        parentFolderGuid: input.parentFolderGuid,
        name: input.name,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })),
    uploadNewFile: (input) => useRuntimeSession(input, (runtime, token) =>
      runtime.client.uploadNewFile({
        token,
        parentFolderGuid: input.parentFolderGuid,
        name: input.name,
        size: input.size,
        read: input.read,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })),
    authorizeDownload: (input) => useRuntimeSession(input, async (runtime, token) => {
      const authorization = await runtime.client.authorizeDownload({
        token,
        fileGuid: input.fileGuid,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      assertNoOpenContentSessionTokenEcho(authorization, token)
      let state: 'available' | 'consumed' | 'retired' = 'available'
      return Object.freeze({
        consume: async ({ write }) => {
          if (state !== 'available') {
            throw new OpenContentConnectorError(
              'unauthorized',
              'The OpenContent download authorization is no longer available.'
            )
          }
          state = 'consumed'
          await assertOpenContentPrincipalCurrent(input.assertPrincipalCurrent)
          return useRuntimeSession(input, (currentRuntime, currentToken) =>
            currentRuntime.client.downloadAuthorizedFile({
              token: currentToken,
              authorization,
              write,
              signal: input.signal,
              assertPrincipalCurrent: input.assertPrincipalCurrent
            }))
        },
        retire: async () => {
          if (state === 'available') state = 'retired'
        }
      })
    })
  })
}
