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
import type { OpenContentClient } from './opencontent-client.js'
import {
  bindOpenContentTeamAdministration,
  type OpenContentTeamAdministration
} from './team-administration.js'
import type { OpenContentSkillRuntimeSession } from './skill-runtime.js'

type OpenContentRootFolder = Awaited<ReturnType<
  OpenContentContentSpaceFacade['listRootFolders']
>>['roots'][number]

export function createOpenContentContentSpaceFacade(options: Readonly<{
  client: OpenContentClient
  connections: OpenContentConnectionService
  teamAdministration: OpenContentTeamAdministration
  skillRuntime?: OpenContentSkillRuntimeSession
}>): OpenContentContentSpaceFacade {
  const useBoundTeamSession = <T>(
    input: Parameters<OpenContentContentSpaceFacade['useTeamAdministration']>[0],
    operation: (session: Readonly<{
      token: string
      externalIdentityId: OpenContentIdentityId
      administration: OpenContentBoundTeamAdministration
      assertSessionCurrent(): Promise<void>
    }>) => T | Promise<T>
  ): Promise<T> => {
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
        options.teamAdministration,
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

  return Object.freeze({
    attestExternalBinding: (input) => options.connections.attestExternalBinding({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    }),
    ...(options.skillRuntime
      ? { useSupplierTransport: options.skillRuntime.useSupplierTransport }
      : {}),
    useTeamAdministration: (input, operation) => useBoundTeamSession(
      input,
      ({ externalIdentityId, administration }) => operation(Object.freeze({
        externalIdentityId,
        administration
      }))
    ),
    listRootFolders: (input) => useBoundTeamSession(input, async ({
      token,
      administration,
      assertSessionCurrent
    }) => {
      const [personalRoot, teamPage] = await Promise.all([
        input.includePersonal === false
          ? Promise.resolve(undefined)
          : options.client.listPersonalRootFolder({
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
    listFolderEntries: (input) => options.connections.useCurrentSession({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      expectedBindingAttestation: input.expectedBindingAttestation,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, ({ token }) => options.client.listFolderEntries({
      token,
      parentFolderGuid: input.parentFolderGuid,
      page: input.page,
      pageSize: input.pageSize,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    observeEntry: (input) => options.connections.useCurrentSession({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      expectedBindingAttestation: input.expectedBindingAttestation,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, ({ token }) => options.client.observeEntry({
      token,
      kind: input.kind,
      resourceGuid: input.resourceGuid,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    createFolder: (input) => options.connections.useCurrentSession({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      expectedBindingAttestation: input.expectedBindingAttestation,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, ({ token }) => options.client.createFolder({
      token,
      parentFolderGuid: input.parentFolderGuid,
      name: input.name,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    uploadNewFile: (input) => options.connections.useCurrentSession({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      expectedBindingAttestation: input.expectedBindingAttestation,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, ({ token }) => options.client.uploadNewFile({
      token,
      parentFolderGuid: input.parentFolderGuid,
      name: input.name,
      size: input.size,
      read: input.read,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    })),
    downloadFile: (input) => options.connections.useCurrentSession({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      expectedBindingAttestation: input.expectedBindingAttestation,
      assertPrincipalCurrent: input.assertPrincipalCurrent,
      signal: input.signal
    }, ({ token }) => options.client.downloadFile({
      token,
      fileGuid: input.fileGuid,
      write: input.write,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    }))
  })
}
