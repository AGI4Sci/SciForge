import {
  CLOUD_SPACES_ROUTE, CLOUD_SPACE_SESSION_ROUTE,
  cloudSpaceEnsureRequestSchema, cloudSpaceResponseSchema, cloudSpacesListResponseSchema,
  cloudSpaceSessionRequestSchema, cloudSpaceSessionGrantSchema,
  type CloudSpaceEnsureRequest, type CloudSpaceSessionRequest, type CloudSpace
} from '@sciforge/cloud-spaces-contracts'
import type { WithCloudTransportLease } from './cloud-authority.js'
import { requestCloudJson } from './cloud-json-request.js'


function ownedPersonalSpace(space: CloudSpace, userId: string): boolean {
  return space.scope.kind !== 'personal' || space.scope.ownerUserId === userId
}

export function listCloudSpaces(withLease: WithCloudTransportLease, options?: Readonly<{ signal?: AbortSignal }>) {
  return requestCloudJson(withLease, {
    path: CLOUD_SPACES_ROUTE, schema: cloudSpacesListResponseSchema, maximumBytes: 1_048_576,
    validate: (result, userId) => result.spaces.every(space => ownedPersonalSpace(space, userId)) &&
      new Set(result.spaces.map(space => space.spaceId)).size === result.spaces.length
  }, options)
}

export function ensureCloudSpace(input: CloudSpaceEnsureRequest, withLease: WithCloudTransportLease,
  options?: Readonly<{ signal?: AbortSignal }>) {
  const request = cloudSpaceEnsureRequestSchema.parse(input)
  return requestCloudJson(withLease, {
    path: CLOUD_SPACES_ROUTE, body: request, schema: cloudSpaceResponseSchema, maximumBytes: 16_384,
    validate: ({ space }, userId) => ownedPersonalSpace(space, userId) && (
      request.scope.kind === 'personal' ? space.scope.kind === 'personal' :
        space.scope.kind === 'project' && space.scope.projectId === request.scope.projectId)
  }, options)
}

/** Returns a main-only bootstrap grant; the caller exchanges its code in a POST body. */
export function createCloudSpaceSession(input: CloudSpaceSessionRequest, withLease: WithCloudTransportLease,
  options?: Readonly<{ signal?: AbortSignal }>) {
  const request = cloudSpaceSessionRequestSchema.parse(input)
  return requestCloudJson(withLease, {
    path: CLOUD_SPACE_SESSION_ROUTE, body: request, schema: cloudSpaceSessionGrantSchema, maximumBytes: 16_384,
    validate: grant => grant.spaceId === request.spaceId && Date.parse(grant.expiresAt) > Date.now()
  }, options)
}
