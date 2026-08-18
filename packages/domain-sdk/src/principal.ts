import { z } from 'zod'

export const MAIN_PRINCIPAL_PROVIDER_CONTRIBUTION_KIND =
  'main.principal-provider' as const

function boundedCanonicalOpaqueIdSchema(maxLength: number) {
  return z.string()
    .min(1)
    .max(maxLength)
    .refine((value) => value === value.trim(), {
      message: 'Principal identifiers must not contain surrounding whitespace.'
    })
    .refine((value) => !hasAsciiControlCharacter(value), {
      message: 'Principal identifiers must not contain control characters.'
    })
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

export const principalAuthoritySchema = boundedCanonicalOpaqueIdSchema(192)
export const principalSubjectSchema = boundedCanonicalOpaqueIdSchema(256)
export const principalDeviceIdSchema = boundedCanonicalOpaqueIdSchema(256)
export const principalIdentityVersionSchema = z.number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const principalAssuranceSchema = z.enum([
  'local-selection',
  'cloud-authenticated'
])

/**
 * Host-captured identity attribution. Authority and subject are separate so a
 * persisted identity cannot collide with the same opaque subject issued by a
 * different Principal provider. Their concrete formats remain provider-owned.
 */
export const principalSnapshotSchema = z.object({
  authority: principalAuthoritySchema,
  subject: principalSubjectSchema,
  assurance: principalAssuranceSchema,
  deviceId: principalDeviceIdSchema,
  identityVersion: principalIdentityVersionSchema
}).strict().readonly()

export const principalContextSnapshotSchema = z.object({
  identityVersion: principalIdentityVersionSchema,
  principal: principalSnapshotSchema.nullable()
}).strict().superRefine((snapshot, context) => {
  if (
    snapshot.principal !== null &&
    snapshot.principal.identityVersion !== snapshot.identityVersion
  ) {
    context.addIssue({
      code: 'custom',
      path: ['principal', 'identityVersion'],
      message: 'Principal and context identity versions must match.'
    })
  }
}).readonly()

export type PrincipalAssurance = z.infer<typeof principalAssuranceSchema>
export type PrincipalSnapshot = z.infer<typeof principalSnapshotSchema>
export type PrincipalContextSnapshot = z.infer<typeof principalContextSnapshotSchema>
export type PrincipalSubscriptionDisposer = () => void
export type PrincipalContextListener = (snapshot: PrincipalContextSnapshot) => void

export type DomainMainPrincipalProvider = Readonly<{
  current(): PrincipalSnapshot | undefined
  snapshot(): PrincipalContextSnapshot
  subscribe(listener: PrincipalContextListener): PrincipalSubscriptionDisposer
}>

export function definePrincipalSnapshot(input: PrincipalSnapshot): PrincipalSnapshot {
  return principalSnapshotSchema.parse(input)
}

export function definePrincipalContextSnapshot(
  input: PrincipalContextSnapshot
): PrincipalContextSnapshot {
  return principalContextSnapshotSchema.parse(input)
}

export function samePrincipalSnapshot(
  left: PrincipalSnapshot | undefined,
  right: PrincipalSnapshot | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.authority === right.authority &&
    left.subject === right.subject &&
    left.assurance === right.assurance &&
    left.deviceId === right.deviceId &&
    left.identityVersion === right.identityVersion
}

/** Compares the complete signed-in or signed-out Host authorization lease. */
export function samePrincipalContextSnapshot(
  left: PrincipalContextSnapshot | undefined,
  right: PrincipalContextSnapshot | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.identityVersion === right.identityVersion &&
    samePrincipalSnapshot(left.principal ?? undefined, right.principal ?? undefined)
}

export function isDomainMainPrincipalProvider(
  value: unknown
): value is DomainMainPrincipalProvider {
  if (!isRecord(value)) return false
  return Object.keys(value).every((key) =>
    key === 'current' || key === 'snapshot' || key === 'subscribe'
  ) &&
    typeof value.current === 'function' &&
    typeof value.snapshot === 'function' &&
    typeof value.subscribe === 'function'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
