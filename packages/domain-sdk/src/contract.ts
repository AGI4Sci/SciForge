import { z } from 'zod'

export const DOMAIN_PACKAGE_CONTRACT_VERSION = 1
export const DOMAIN_PACKAGE_HOST_API_VERSION = '1.0.0'

const stableSemanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export const domainPackageProcessSchema = z.enum(['main', 'renderer'])
export type DomainPackageProcess = z.infer<typeof domainPackageProcessSchema>

export const domainPackageNameSchema = z.string()
  .trim()
  .min(3)
  .max(214)
  .regex(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/, 'Use a scoped lowercase package name.')

export const domainPackageModuleIdSchema = z.string()
  .trim()
  .min(3)
  .max(192)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/, 'Use a namespaced lowercase module ID.')

export const domainPackageContributionIdSchema = z.string()
  .trim()
  .min(3)
  .max(192)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/, 'Use a namespaced lowercase contribution ID.')

export const domainPackageContributionKindSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/, 'Use a lowercase contribution kind.')

export type DomainPackageJsonValue =
  | null
  | boolean
  | number
  | string
  | DomainPackageJsonValue[]
  | { [key: string]: DomainPackageJsonValue }

export const domainPackageJsonValueSchema: z.ZodType<DomainPackageJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(100_000),
  z.array(domainPackageJsonValueSchema).max(10_000),
  z.record(z.string().trim().min(1).max(192), domainPackageJsonValueSchema)
]))

export const domainPackageStableVersionSchema = z.string()
  .trim()
  .max(64)
  .regex(stableSemanticVersionPattern, 'Expected a stable semantic version in x.y.z form.')
  .superRefine((version, context) => {
    if (version.split('.').some((part) => !Number.isSafeInteger(Number(part)))) {
      context.addIssue({ code: 'custom', message: 'Semantic version components must be safe integers.' })
    }
  })

export const domainPackageVersionSchema = z.string()
  .trim()
  .max(128)
  .regex(semanticVersionPattern, 'Expected a semantic version.')

export const domainPackageHostApiRangeSchema = z.object({
  minimum: domainPackageStableVersionSchema,
  maximumExclusive: domainPackageStableVersionSchema
}).strict().superRefine((range, context) => {
  if (compareStableSemanticVersions(range.minimum, range.maximumExclusive) >= 0) {
    context.addIssue({
      code: 'custom',
      path: ['maximumExclusive'],
      message: 'Host API maximumExclusive must be greater than minimum.'
    })
  }
})

export const domainPackageContributionDeclarationSchema = z.object({
  id: domainPackageContributionIdSchema,
  kind: domainPackageContributionKindSchema,
  version: domainPackageVersionSchema.optional(),
  priority: z.number().int().min(-10_000).max(10_000).default(100)
}).strict()

const mainEntrypointSchema = z.object({
  process: z.literal('main'),
  export: z.literal('./main'),
  contributions: z.array(domainPackageContributionDeclarationSchema).max(1_000).default([])
}).strict()

const rendererEntrypointSchema = z.object({
  process: z.literal('renderer'),
  export: z.literal('./renderer'),
  contributions: z.array(domainPackageContributionDeclarationSchema).max(1_000).default([])
}).strict()

export const domainPackageEntrypointSchema = z.discriminatedUnion('process', [
  mainEntrypointSchema,
  rendererEntrypointSchema
])

export const trustedDomainPackageDefinitionSchema = z.object({
  contractVersion: z.literal(DOMAIN_PACKAGE_CONTRACT_VERSION),
  kind: z.literal('trusted-compile-time'),
  packageName: domainPackageNameSchema,
  module: z.object({
    id: domainPackageModuleIdSchema,
    displayName: z.string().trim().min(1).max(160),
    version: domainPackageVersionSchema,
    hostApi: domainPackageHostApiRangeSchema,
    priority: z.number().int().min(-10_000).max(10_000).default(100)
  }).strict(),
  contributionContracts: z.record(
    domainPackageContributionIdSchema,
    domainPackageJsonValueSchema
  ).default({}),
  entrypoints: z.array(domainPackageEntrypointSchema).min(1).max(2)
}).strict().superRefine((definition, context) => {
  const processes = new Set<DomainPackageProcess>()
  const contributionIds = new Set<string>()
  for (const [entrypointIndex, entrypoint] of definition.entrypoints.entries()) {
    if (processes.has(entrypoint.process)) {
      context.addIssue({
        code: 'custom',
        path: ['entrypoints', entrypointIndex, 'process'],
        message: `Domain package ${definition.packageName} declares ${entrypoint.process} more than once.`
      })
    }
    processes.add(entrypoint.process)

    const contributionKeys = new Set<string>()
    for (const [contributionIndex, contribution] of entrypoint.contributions.entries()) {
      contributionIds.add(contribution.id)
      const key = domainContributionKey(contribution.kind, contribution.id)
      if (contributionKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['entrypoints', entrypointIndex, 'contributions', contributionIndex],
          message: `Duplicate ${entrypoint.process} contribution ${contribution.kind}:${contribution.id}.`
        })
      }
      contributionKeys.add(key)
    }
  }
  for (const contractId of Object.keys(definition.contributionContracts)) {
    if (contributionIds.has(contractId)) continue
    context.addIssue({
      code: 'custom',
      path: ['contributionContracts', contractId],
      message: `Contribution contract ${contractId} has no declared contribution.`
    })
  }
})

export type DomainPackageHostApiRange = z.infer<typeof domainPackageHostApiRangeSchema>
export type DomainPackageContributionDeclaration = z.infer<
  typeof domainPackageContributionDeclarationSchema
>
export type DomainPackageEntrypoint = z.infer<typeof domainPackageEntrypointSchema>
export type TrustedDomainPackageDefinition = z.infer<typeof trustedDomainPackageDefinitionSchema>
export type TrustedDomainPackageDefinitionInput = z.input<typeof trustedDomainPackageDefinitionSchema>

export function defineTrustedDomainPackage(
  input: TrustedDomainPackageDefinitionInput
): TrustedDomainPackageDefinition {
  return deepFreeze(trustedDomainPackageDefinitionSchema.parse(input))
}

export function domainContributionKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`
}

export function domainPackageJsonValuesEqual(
  left: DomainPackageJsonValue,
  right: DomainPackageJsonValue
): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

export function isDomainPackageHostApiCompatible(
  range: DomainPackageHostApiRange,
  hostApiVersion: string
): boolean {
  const normalizedRange = domainPackageHostApiRangeSchema.parse(range)
  const normalizedHostVersion = domainPackageStableVersionSchema.parse(hostApiVersion)
  return compareStableSemanticVersions(normalizedHostVersion, normalizedRange.minimum) >= 0 &&
    compareStableSemanticVersions(normalizedHostVersion, normalizedRange.maximumExclusive) < 0
}

export function compareStableSemanticVersions(left: string, right: string): number {
  const leftParts = parseStableSemanticVersion(left)
  const rightParts = parseStableSemanticVersion(right)
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

function parseStableSemanticVersion(version: string): [number, number, number] {
  const normalized = domainPackageStableVersionSchema.parse(version)
  const [major, minor, patch] = normalized.split('.').map(Number)
  return [major!, minor!, patch!]
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

function canonicalJson(value: DomainPackageJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`
  ).join(',')}}`
}
