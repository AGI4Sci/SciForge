import {
  OpenContentConnectorError,
  type OpenContentContentSpaceFacade
} from '../contract.js'
import {
  openContentIdentityIdSchema
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

export function createOpenContentContentSpaceFacade(options: Readonly<{
  client: OpenContentClient
  connections: OpenContentConnectionService
  teamAdministration: OpenContentTeamAdministration
  skillRuntime?: OpenContentSkillRuntimeSession
}>): OpenContentContentSpaceFacade {
  return Object.freeze({
    attestExternalBinding: (input) => options.connections.attestExternalBinding({
      principal: input.principal,
      providerInstanceRef: input.providerInstanceRef,
      signal: input.signal,
      assertPrincipalCurrent: input.assertPrincipalCurrent
    }),
    ...(options.skillRuntime
      ? { useSkillRuntime: options.skillRuntime.useSkillRuntime }
      : {}),
    useTeamAdministration: (input, operation) => {
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
      expectedBindingAttestation: input.expectedBindingAttestation,
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
      expectedBindingAttestation: input.expectedBindingAttestation,
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
      expectedBindingAttestation: input.expectedBindingAttestation,
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
      expectedBindingAttestation: input.expectedBindingAttestation,
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
      expectedBindingAttestation: input.expectedBindingAttestation,
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
      expectedBindingAttestation: input.expectedBindingAttestation,
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
