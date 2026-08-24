import { z } from 'zod'
import {
  agentIdSchema,
  deviceIdSchema,
  displayNameSchema,
  entityMetadataShape,
  humanEndpointIdSchema,
  idempotencyKeySchema,
  installationIdSchema,
  oidcIdentityIdSchema,
  protocolEnvelopeShape,
  protocolVersionSchema,
  requestIdSchema,
  revisionSchema,
  schemaVersionSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import {
  agentCapabilitySchema,
  agentNodeSchema,
  humanEndpointBindingSchema,
  userPrincipalSchema
} from './entities.js'

const opaqueSuffix = '[A-Za-z0-9](?:[A-Za-z0-9_]{10,62}[A-Za-z0-9])'

function opaqueId(prefix: string): z.ZodString {
  return z.string().regex(new RegExp(`^${prefix}_${opaqueSuffix}$`, 'u'))
}

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function isBase64UrlBytes(value: string, expectedBytes: number | { min: number }): boolean {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) return false
  const remainder = value.length % 4
  const finalSextet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    .indexOf(value.at(-1)!)
  if ((remainder === 2 && (finalSextet & 0x0f) !== 0) ||
      (remainder === 3 && (finalSextet & 0x03) !== 0)) return false
  const decodedLength = Math.floor(value.length * 3 / 4)
  return typeof expectedBytes === 'number'
    ? decodedLength === expectedBytes
    : decodedLength >= expectedBytes.min
}

export const deviceEnrollmentIdSchema = opaqueId('enr')
export const externalIdentityIdSchema = opaqueId('xid')
export type OidcIdentityId = z.infer<typeof oidcIdentityIdSchema>
export type DeviceEnrollmentId = z.infer<typeof deviceEnrollmentIdSchema>
export const oidcSubjectSchema = z.string().min(1).max(512)
export const oidcAudienceSchema = z.string().trim().min(1).max(512)
export const identityEmailSchema = z.string().trim().email().max(320)

function canNormalizeIssuer(value: string): boolean {
  try {
    normalizeOidcIssuer(value)
    return true
  } catch {
    return false
  }
}

export function normalizeOidcIssuer(value: string): string {
  const issuer = new URL(value.trim())
  const isLoopbackHttp = issuer.protocol === 'http:' && (
    issuer.hostname === 'localhost' || issuer.hostname === '127.0.0.1' || issuer.hostname === '[::1]'
  )
  if (
    (issuer.protocol !== 'https:' && !isLoopbackHttp) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new TypeError(
      'OIDC issuer must use HTTPS, except for loopback HTTP during local development, and contain no credentials, query, or fragment.'
    )
  }
  issuer.pathname = issuer.pathname.replace(/\/+$/u, '') || '/'
  return issuer.toString().replace(/\/$/u, '')
}

export const oidcIssuerSchema = z.string().trim().min(1).max(2_048)
  .refine(canNormalizeIssuer, 'OIDC issuer must be a canonical HTTPS URL or a loopback HTTP development URL')
  .transform(normalizeOidcIssuer)

export const oidcIdentityStatusSchema = z.enum(['active', 'revoked'])
export type OidcIdentityStatus = z.infer<typeof oidcIdentityStatusSchema>

export const verifiedOidcClaimsSchema = z.object({
  type: z.literal('verified_oidc_claims'),
  issuer: oidcIssuerSchema,
  subject: oidcSubjectSchema,
  audiences: z.array(oidcAudienceSchema).min(1).max(32).refine(
    (audiences) => new Set(audiences).size === audiences.length,
    'OIDC audiences must be unique'
  ),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
  email: identityEmailSchema.optional(),
  emailVerified: z.boolean().optional(),
  displayName: displayNameSchema.optional()
}).strict().superRefine((claims, context) => {
  if (Date.parse(claims.expiresAt) <= Date.parse(claims.issuedAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'OIDC token must expire after it is issued' })
  }
})
export type VerifiedOidcClaims = z.infer<typeof verifiedOidcClaimsSchema>

export const oidcExternalIdentitySchema = z.object({
  ...entityMetadataShape,
  type: z.literal('oidc_external_identity'),
  externalIdentityId: externalIdentityIdSchema,
  userId: userIdSchema,
  issuer: oidcIssuerSchema,
  subject: oidcSubjectSchema,
  emailAtLinkTime: identityEmailSchema.optional(),
  status: oidcIdentityStatusSchema,
  verifiedAt: timestampSchema,
  revokedAt: timestampSchema.optional()
}).strict().superRefine((identity, context) => {
  if ((identity.status === 'revoked') !== (identity.revokedAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'Only revoked OIDC identity requires revokedAt' })
  }
})
export type OidcExternalIdentity = z.infer<typeof oidcExternalIdentitySchema>

// The OIDC access token belongs in the Authorization header and is deliberately
// excluded from this JSON body so logs and receipts cannot persist it.
export const oidcExchangeRequestSchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('oidc.exchange')
}).strict()
export type OidcExchangeRequest = z.infer<typeof oidcExchangeRequestSchema>

export const oidcExchangeResponseSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: requestIdSchema,
  type: z.literal('oidc.exchanged'),
  user: userPrincipalSchema,
  identity: oidcExternalIdentitySchema,
  userCredential: z.string().min(32).max(2_048)
}).strict()
export type OidcExchangeResponse = z.infer<typeof oidcExchangeResponseSchema>

export const currentUserResponseSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: requestIdSchema,
  type: z.literal('identity.me'),
  user: userPrincipalSchema,
  identity: oidcExternalIdentitySchema
}).strict().superRefine((response, context) => {
  if (response.user.userId !== response.identity.userId) {
    context.addIssue({
      code: 'custom',
      path: ['identity', 'userId'],
      message: 'OIDC identity must belong to the returned SciForge user'
    })
  }
})
export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>

export const collaborationIdentitySnapshotSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: requestIdSchema,
  type: z.literal('identity.snapshot'),
  user: userPrincipalSchema,
  oidcIdentities: z.array(oidcExternalIdentitySchema).max(32),
  humanEndpoints: z.array(humanEndpointBindingSchema).max(100),
  devices: z.array(z.lazy(() => deviceRecordSchema)).max(100),
  deviceAgentLinks: z.array(z.lazy(() => deviceAgentLinkSchema)).max(100),
  agents: z.array(agentNodeSchema).max(100)
}).strict()
export type CollaborationIdentitySnapshot = z.infer<typeof collaborationIdentitySnapshotSchema>

export const deviceOperatingSystemSchema = z.enum(['windows', 'macos', 'linux'])
export const deviceArchitectureSchema = z.enum(['x64', 'arm64'])
export const devicePlatformSchema = z.object({
  os: deviceOperatingSystemSchema,
  arch: deviceArchitectureSchema,
  osVersion: z.string().trim().min(1).max(200).optional(),
  appVersion: z.string().trim().min(1).max(200)
}).strict()
export type DevicePlatform = z.infer<typeof devicePlatformSchema>

export const devicePublicKeySchema = z.object({
  kty: z.literal('OKP'),
  crv: z.literal('Ed25519'),
  alg: z.literal('EdDSA'),
  use: z.literal('sig'),
  kid: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  x: z.string().min(1).max(128).refine((value) => isBase64UrlBytes(value, 32), {
    message: 'Ed25519 public JWK x must be canonical base64url for exactly 32 bytes'
  })
}).strict()
export type DevicePublicKey = z.infer<typeof devicePublicKeySchema>
export const ed25519PublicJwkSchema = devicePublicKeySchema
export type Ed25519PublicJwk = DevicePublicKey

const enrollmentIdSchema = deviceEnrollmentIdSchema
export const enrollmentNonceSchema = z.string().min(43).max(512).refine(
  (value) => isBase64UrlBytes(value, { min: 32 }),
  { message: 'Device enrollment nonce must be canonical base64url for at least 32 bytes' }
)
export const ed25519SignatureSchema = z.string().min(86).max(128).refine(
  (value) => isBase64UrlBytes(value, 64),
  { message: 'Ed25519 signature must be canonical base64url for exactly 64 bytes' }
)

export const deviceEnrollmentStartSchema = z.object({
  installationId: installationIdSchema
}).strict()
export type DeviceEnrollmentStart = z.infer<typeof deviceEnrollmentStartSchema>

export const deviceEnrollmentChallengeSchema = z.object({
  ...protocolEnvelopeShape,
  type: z.literal('device.enrollment.challenge'),
  enrollmentId: enrollmentIdSchema,
  userId: userIdSchema,
  installationId: installationIdSchema,
  nonce: enrollmentNonceSchema,
  expiresAt: timestampSchema
}).strict()
export type DeviceEnrollmentChallenge = z.infer<typeof deviceEnrollmentChallengeSchema>

export const devicePossessionProofSchema = z.object({
  alg: z.literal('EdDSA'),
  signature: ed25519SignatureSchema
}).strict()
export type DevicePossessionProof = z.infer<typeof devicePossessionProofSchema>

export const desktopDeviceRegistrationSchema = z.object({
  enrollmentId: enrollmentIdSchema,
  installationId: installationIdSchema,
  displayName: displayNameSchema,
  platform: devicePlatformSchema,
  publicKey: devicePublicKeySchema,
  capabilities: z.array(agentCapabilitySchema).max(256).refine(
    (capabilities) => new Set(capabilities).size === capabilities.length,
    'Capabilities must be unique'
  ),
  proof: devicePossessionProofSchema
}).strict()
export type DesktopDeviceRegistration = z.infer<typeof desktopDeviceRegistrationSchema>

export const legacyDeviceStatusSchema = z.enum(['pending', 'active', 'revoked'])
export const deviceRecordSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('device'),
  deviceId: deviceIdSchema,
  userId: userIdSchema,
  installationId: installationIdSchema,
  displayName: displayNameSchema,
  platform: devicePlatformSchema,
  publicKey: devicePublicKeySchema,
  status: legacyDeviceStatusSchema,
  activatedAt: timestampSchema.optional(),
  revokedAt: timestampSchema.optional()
}).strict().superRefine((device, context) => {
  if ((device.status !== 'pending') !== (device.activatedAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['activatedAt'], message: 'Activated or revoked Device requires activatedAt' })
  }
  if ((device.status === 'revoked') !== (device.revokedAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['revokedAt'], message: 'Only revoked Device requires revokedAt' })
  }
})
export type DeviceRecord = z.infer<typeof deviceRecordSchema>

export const currentDevicesResponseSchema = z.object({
  protocolVersion: protocolVersionSchema,
  requestId: requestIdSchema,
  type: z.literal('identity.devices'),
  devices: z.array(deviceRecordSchema).max(100)
}).strict()
export type CurrentDevicesResponse = z.infer<typeof currentDevicesResponseSchema>

// A's frozen public identity contract at 028827a8252e25cce2a99aa9e98118bb9022d8e7.
// These schemas intentionally mirror the REST payloads rather than the legacy
// protocol envelopes above.
export const meResponseSchema = z.object({
  schemaVersion: schemaVersionSchema,
  type: z.literal('me'),
  userId: userIdSchema,
  displayName: displayNameSchema,
  status: z.literal('active'),
  oidcIdentityId: oidcIdentityIdSchema,
  issuer: oidcIssuerSchema,
  revision: revisionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()
export type MeResponse = z.infer<typeof meResponseSchema>

export const deviceStatusSchema = z.enum(['active', 'revoked'])
export const deviceCapabilitySchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/u)

export const deviceSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('device'),
  deviceId: deviceIdSchema,
  userId: userIdSchema,
  installationId: installationIdSchema,
  displayName: displayNameSchema,
  platform: devicePlatformSchema,
  publicKeyJwk: ed25519PublicJwkSchema,
  capabilitySummary: z.array(deviceCapabilitySchema).max(256)
    .refine(uniqueStrings, 'Device capability summary values must be unique'),
  status: deviceStatusSchema,
  revokedAt: timestampSchema.optional()
}).strict().superRefine((device, context) => {
  if ((device.status === 'revoked') !== (device.revokedAt !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['revokedAt'],
      message: 'Revoked Device requires revokedAt exclusively'
    })
  }
})
export type Device = z.infer<typeof deviceSchema>

export const deviceEnrollmentCreateRequestSchema = z.object({
  installationId: installationIdSchema,
  idempotencyKey: idempotencyKeySchema
}).strict()
export type DeviceEnrollmentCreateRequest = z.infer<typeof deviceEnrollmentCreateRequestSchema>

export const deviceEnrollmentCreateResponseSchema = z.object({
  enrollmentId: deviceEnrollmentIdSchema,
  nonce: enrollmentNonceSchema,
  expiresAt: timestampSchema
}).strict()
export type DeviceEnrollmentCreateResponse = z.infer<typeof deviceEnrollmentCreateResponseSchema>

export const deviceCreateRequestSchema = z.object({
  enrollmentId: deviceEnrollmentIdSchema,
  nonce: enrollmentNonceSchema,
  installationId: installationIdSchema,
  displayName: displayNameSchema,
  platform: devicePlatformSchema,
  publicKeyJwk: ed25519PublicJwkSchema,
  capabilitySummary: z.array(deviceCapabilitySchema).max(256)
    .refine(uniqueStrings, 'Device capability summary values must be unique'),
  signature: ed25519SignatureSchema,
  idempotencyKey: idempotencyKeySchema
}).strict()
export type DeviceCreateRequest = z.infer<typeof deviceCreateRequestSchema>

export const deviceResponseSchema = z.object({ device: deviceSchema }).strict()
export type DeviceResponse = z.infer<typeof deviceResponseSchema>

export const deviceListResponseSchema = z.object({
  devices: z.array(deviceSchema).max(1_000)
    .refine(
      (devices) => uniqueStrings(devices.map((device) => device.deviceId)),
      'Device IDs must be unique'
    )
}).strict()
export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>

export const deviceRevokeRequestSchema = z.object({
  deviceId: deviceIdSchema,
  idempotencyKey: idempotencyKeySchema
}).strict()
export type DeviceRevokeRequest = z.infer<typeof deviceRevokeRequestSchema>

export type EnrollmentSigningFacts = Readonly<{
  enrollmentId: string
  nonce: string
  userId: string
  installationId: string
  expiresAt: string
}>

const DEVICE_ENROLLMENT_SIGNING_DOMAIN = 'SCIFORGE-DEVICE-ENROLLMENT-V1'

/**
 * Returns the exact UTF-8 bytes that a Device signs to prove possession of its
 * Ed25519 key during enrollment. The final field is not followed by a LF.
 */
export function canonicalEnrollmentBytes(input: EnrollmentSigningFacts): Uint8Array {
  const values = [
    DEVICE_ENROLLMENT_SIGNING_DOMAIN,
    input.enrollmentId,
    input.nonce,
    input.userId,
    input.installationId,
    input.expiresAt
  ]
  if (values.some((value) => (
    typeof value !== 'string' || value.length === 0 || /[\r\n]/u.test(value)
  ))) {
    throw new TypeError('Enrollment signing fields must be non-empty strings without line breaks.')
  }
  return new TextEncoder().encode(values.join('\n'))
}

export const deviceAgentLinkSchema = z.object({
  deviceId: deviceIdSchema,
  agentId: agentIdSchema
}).strict()
export type DeviceAgentLink = z.infer<typeof deviceAgentLinkSchema>

export const identityAuditSourceSchema = z.enum(['oidc', 'desktop', 'system'])
export const identityAuditActionSchema = z.enum([
  'oidc.exchanged',
  'oidc.revoked',
  'device.enrollment.started',
  'device.registered',
  'device.revoked',
  'agent.registered',
  'agent.revoked'
])
export const identityAuditEventSchema = z.object({
  requestId: requestIdSchema,
  actorUserId: userIdSchema,
  source: identityAuditSourceSchema,
  action: identityAuditActionSchema,
  externalIdentityId: externalIdentityIdSchema.optional(),
  humanEndpointId: humanEndpointIdSchema.optional(),
  deviceId: deviceIdSchema.optional(),
  agentId: agentIdSchema.optional(),
  occurredAt: timestampSchema
}).strict()
export type IdentityAuditEvent = z.infer<typeof identityAuditEventSchema>

export function oidcIdentityKey(identity: Pick<OidcExternalIdentity, 'issuer' | 'subject'>): string {
  return `${normalizeOidcIssuer(identity.issuer)}\u0000${identity.subject}`
}
