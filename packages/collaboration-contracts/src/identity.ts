import { z } from 'zod'

import {
  deviceIdSchema,
  displayNameSchema,
  entityMetadataShape,
  idempotencyKeySchema,
  installationIdSchema,
  oidcIdentityIdSchema,
  revisionSchema,
  schemaVersionSchema,
  sha256Schema,
  timestampSchema,
  userIdSchema
} from './core.js'

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
export type OidcIdentityId = z.infer<typeof oidcIdentityIdSchema>
export type DeviceEnrollmentId = z.infer<typeof deviceEnrollmentIdSchema>

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

export const enrollmentNonceSchema = z.string().min(43).max(512).refine(
  (value) => isBase64UrlBytes(value, { min: 32 }),
  { message: 'Device enrollment nonce must be canonical base64url for at least 32 bytes' }
)
export const ed25519SignatureSchema = z.string().min(86).max(128).refine(
  (value) => isBase64UrlBytes(value, 64),
  { message: 'Ed25519 signature must be canonical base64url for exactly 64 bytes' }
)

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

export const deviceFactAttestationPurposeSchema = z.literal(
  'project-content-provisioning-attestation'
)
export type DeviceFactAttestationPurpose = z.infer<typeof deviceFactAttestationPurposeSchema>

export const deviceFactSigningRequestSchema = z.object({
  purpose: deviceFactAttestationPurposeSchema,
  factDigest: sha256Schema,
  factRevision: revisionSchema,
  observedAt: timestampSchema
}).strict()
export type DeviceFactSigningRequest = z.infer<typeof deviceFactSigningRequestSchema>

export const deviceFactSignatureMetadataSchema = z.object({
  purpose: deviceFactAttestationPurposeSchema,
  userId: userIdSchema,
  deviceId: deviceIdSchema,
  deviceKeyId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  deviceKeyRevision: revisionSchema,
  signatureAlgorithm: z.literal('Ed25519'),
  canonicalPayloadDigest: sha256Schema,
  factRevision: revisionSchema,
  observedAt: timestampSchema,
  issuedAt: timestampSchema,
  signature: ed25519SignatureSchema
}).strict()
export type DeviceFactSignatureMetadata = z.infer<typeof deviceFactSignatureMetadataSchema>

export type DeviceFactSigningFacts = Readonly<{
  purpose: DeviceFactAttestationPurpose
  userId: string
  deviceId: string
  deviceKeyId: string
  deviceKeyRevision: number
  canonicalPayloadDigest: string
  factRevision: number
  observedAt: string
  issuedAt: string
}>

const DEVICE_FACT_SIGNING_DOMAIN = 'SCIFORGE-DEVICE-FACT-ATTESTATION-V1'

/**
 * Canonical bytes for the one allowlisted Device fact-signing purpose. Domains
 * never submit arbitrary bytes to the Device key owner.
 */
export function canonicalDeviceFactAttestationBytes(input: DeviceFactSigningFacts): Uint8Array {
  const purpose = deviceFactAttestationPurposeSchema.parse(input.purpose)
  const values = [
    DEVICE_FACT_SIGNING_DOMAIN,
    purpose,
    userIdSchema.parse(input.userId),
    deviceIdSchema.parse(input.deviceId),
    z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u).parse(input.deviceKeyId),
    String(revisionSchema.parse(input.deviceKeyRevision)),
    sha256Schema.parse(input.canonicalPayloadDigest),
    String(revisionSchema.parse(input.factRevision)),
    timestampSchema.parse(input.observedAt),
    timestampSchema.parse(input.issuedAt)
  ]
  if (values.some((value) => /[\r\n]/u.test(value))) {
    throw new TypeError('Device fact signing fields cannot contain line breaks.')
  }
  return new TextEncoder().encode(values.join('\n'))
}

export type EnrollmentSigningFacts = Readonly<{
  enrollmentId: string
  nonce: string
  userId: string
  installationId: string
  expiresAt: string
}>

const DEVICE_ENROLLMENT_SIGNING_DOMAIN = 'SCIFORGE-DEVICE-ENROLLMENT-V1'

/** Returns the exact enrollment possession-proof bytes. */
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
