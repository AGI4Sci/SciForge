import {
  type AuthenticatedCloudTransport
} from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type {
  CoordinatorCloudCommandService
} from '@sciforge/domain-collaboration/coordinator-cloud-command'
import type {
  DeviceFactAttestationSigningService,
  DeviceFactSignatureMetadata,
  DeviceFactSigningRequest
} from '@sciforge/domain-identity-access/device-fact-attestation-signing'

import {
  projectCoordinatorWorkspaceReadInputSchema,
  projectCoordinatorWorkspaceSchema,
  type ProjectCoordinatorWorkspace,
  type ProjectCoordinatorWorkspaceReadInput
} from './contract.js'

export type ProjectCoordinatorWorkspacePort = Readonly<{
  readWorkspace(input: ProjectCoordinatorWorkspaceReadInput): Promise<ProjectCoordinatorWorkspace>
}>

export type ProjectContentProvisioningAttestationSigningPort = Readonly<{
  signFactualPayload(
    input: Omit<DeviceFactSigningRequest, 'purpose'>
  ): Promise<DeviceFactSignatureMetadata>
}>

export type ProjectCoordinatorMainPorts = Readonly<{
  workspace: ProjectCoordinatorWorkspacePort
  provisioningAttestationSigning: ProjectContentProvisioningAttestationSigningPort
  coordinatorCloudCommands: CoordinatorCloudCommandService
}>

export function defineProjectCoordinatorWorkspacePort(
  input: ProjectCoordinatorWorkspacePort
): ProjectCoordinatorWorkspacePort {
  if (!input || typeof input !== 'object' || typeof input.readWorkspace !== 'function') {
    throw new TypeError('Project Coordinator workspace port is invalid.')
  }
  return Object.freeze({
    readWorkspace: async (request) => projectCoordinatorWorkspaceSchema.parse(
      await input.readWorkspace(projectCoordinatorWorkspaceReadInputSchema.parse(request))
    )
  })
}

/**
 * Fail-closed bridge for the package skeleton.
 *
 * Identity owns OIDC and Device checks. This package intentionally does not
 * issue a made-up Cloud command until the versioned coordination read model is
 * part of the canonical Cloud contract.
 */
export function createIdentityMediatedProjectCoordinatorWorkspacePort(options: Readonly<{
  transport: AuthenticatedCloudTransport
  now?: () => Date
}>): ProjectCoordinatorWorkspacePort {
  const now = options.now ?? (() => new Date())
  return defineProjectCoordinatorWorkspacePort({
    readWorkspace: async () => {
      const status = options.transport.status()
      const observedAt = now().toISOString()
      if (status.state === 'ready') {
        return {
          connection: {
            state: 'coordination_protocol_unavailable',
            userId: status.userId,
            deviceId: status.deviceId,
            reason: 'The versioned Project coordination read model is not available.'
          },
          observedAt,
          projects: []
        }
      }
      if (status.state === 'identity_required') {
        return {
          connection: { state: 'identity_required' },
          observedAt,
          projects: []
        }
      }
      if (status.state === 'device_required') {
        return {
          connection: { state: 'device_required', reason: status.reason },
          observedAt,
          projects: []
        }
      }
      return {
        connection: { state: 'cloud_unavailable', reason: status.reason },
        observedAt,
        projects: []
      }
    }
  })
}

/**
 * Purpose-locked delegation to Identity. Device keys and signature operations
 * remain entirely inside the Identity service owner.
 */
export function createProjectContentProvisioningAttestationSigningPort(
  service: DeviceFactAttestationSigningService
): ProjectContentProvisioningAttestationSigningPort {
  return Object.freeze({
    signFactualPayload: (input) => service.signDeviceFact({
      ...input,
      purpose: 'project-content-provisioning-attestation'
    })
  })
}
