import { z } from 'zod'

export const DOMAIN_PACKAGE_CONTRACT_VERSION = 1
export const DOMAIN_PACKAGE_HOST_API_VERSION = '1.9.0'
export const DOMAIN_PACKAGE_IMPLICIT_RUNTIME_PATHS = Object.freeze([
  'package.json',
  'sciforge.domain.json'
] as const)

const stableSemanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export const domainPackageProcessSchema = z.enum(['main', 'renderer', 'workspace-server'])
export type DomainPackageProcess = z.infer<typeof domainPackageProcessSchema>

export const domainPackageNameSchema = z.string()
  .trim()
  .min(3)
  .max(214)
  .regex(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/, 'Use a scoped lowercase package name.')

export const domainPackageRelativePathSchema = z.string()
  .trim()
  .min(1)
  .max(1_024)
  .superRefine((relativePath, context) => {
    if (
      relativePath.startsWith('/') ||
      /^[A-Za-z]:\//.test(relativePath) ||
      relativePath.includes('\\') ||
      relativePath.includes('\0')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Use a package-relative POSIX path.'
      })
      return
    }
    const segments = relativePath.split('/')
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      context.addIssue({
        code: 'custom',
        message: 'Package-relative paths cannot contain empty, current, or parent segments.'
      })
    }
  })

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

export const domainPackageContributionPublicReleasePolicySchema = z.enum([
  'allowed',
  'forbidden'
])

export const domainPackagePublisherIdSchema = z.string()
  .trim()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    'Use a lowercase publisher ID containing letters, numbers, or internal hyphens.'
  )

export const domainPackagePublisherSchema = z.object({
  id: domainPackagePublisherIdSchema,
  displayName: z.string().trim().min(1).max(160)
}).strict()

export const domainPackagePermissionIdSchema = z.string()
  .trim()
  .min(3)
  .max(192)
  .regex(
    /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/,
    'Use a namespaced lowercase permission ID.'
  )

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

export const domainPackageModuleSchema = z.object({
  id: domainPackageModuleIdSchema,
  displayName: z.string().trim().min(1).max(160),
  version: domainPackageVersionSchema,
  hostApi: domainPackageHostApiRangeSchema,
  priority: z.number().int().min(-10_000).max(10_000).default(100)
}).strict()

export const domainPackageContributionDeclarationSchema = z.object({
  id: domainPackageContributionIdSchema,
  kind: domainPackageContributionKindSchema,
  version: domainPackageVersionSchema.optional(),
  publicRelease: domainPackageContributionPublicReleasePolicySchema.optional(),
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

const workspaceServerEntrypointSchema = z.object({
  process: z.literal('workspace-server'),
  export: z.literal('./workspace-server'),
  contributions: z.array(domainPackageContributionDeclarationSchema).max(1_000).default([])
}).strict()

export const domainPackageEntrypointSchema = z.discriminatedUnion('process', [
  mainEntrypointSchema,
  rendererEntrypointSchema,
  workspaceServerEntrypointSchema
])

const sandboxedMainEntrypointSchema = z.object({
  process: z.literal('main'),
  isolation: z.literal('extension-host'),
  entry: domainPackageRelativePathSchema,
  format: z.literal('module'),
  contributions: z.array(domainPackageContributionDeclarationSchema).max(1_000).default([])
}).strict()

const sandboxedRendererEntrypointSchema = z.object({
  process: z.literal('renderer'),
  isolation: z.literal('sandboxed-webview'),
  entry: domainPackageRelativePathSchema,
  format: z.literal('html'),
  contributions: z.array(domainPackageContributionDeclarationSchema).max(1_000).default([])
}).strict()

export const sandboxedDomainPackageEntrypointSchema = z.discriminatedUnion('process', [
  sandboxedMainEntrypointSchema,
  sandboxedRendererEntrypointSchema
])

export const domainPackageRequestedPermissionSchema = z.object({
  id: domainPackagePermissionIdSchema,
  process: z.enum(['main', 'renderer']),
  reason: z.string().trim().min(1).max(500),
  required: z.boolean(),
  parameters: z.record(
    z.string().trim().min(1).max(192),
    domainPackageJsonValueSchema
  ).optional()
}).strict()

export const domainPackageRuntimePackagingSchema = z.object({
  requiredPaths: z.array(domainPackageRelativePathSchema).max(1_000).default([]),
  dependencies: z.array(domainPackageNameSchema).max(1_000).default([])
}).strict().superRefine((runtime, context) => {
  for (const [field, values] of [
    ['requiredPaths', runtime.requiredPaths],
    ['dependencies', runtime.dependencies]
  ] as const) {
    const seen = new Set<string>()
    for (const [index, value] of values.entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: 'custom',
          path: [field, index],
          message: `Duplicate ${field} value ${value}.`
        })
      }
      seen.add(value)
    }
  }
  for (const [index, requiredPath] of runtime.requiredPaths.entries()) {
    if (!(DOMAIN_PACKAGE_IMPLICIT_RUNTIME_PATHS as readonly string[]).includes(requiredPath)) continue
    context.addIssue({
      code: 'custom',
      path: ['requiredPaths', index],
      message: `${requiredPath} is included implicitly for every bundled domain package.`
    })
  }
})

export const domainPackagePackagingSchema = z.object({
  bundled: z.boolean(),
  runtime: domainPackageRuntimePackagingSchema.optional()
}).strict().superRefine((packaging, context) => {
  if (
    !packaging.bundled &&
    packaging.runtime &&
    (packaging.runtime.requiredPaths.length > 0 || packaging.runtime.dependencies.length > 0)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['runtime'],
      message: 'Non-bundled domain packages cannot declare packaged runtime requirements.'
    })
  }
})

export const trustedDomainPackageDefinitionSchema = z.object({
  contractVersion: z.literal(DOMAIN_PACKAGE_CONTRACT_VERSION),
  kind: z.literal('trusted-compile-time'),
  composition: z.enum(['production', 'development-only']).default('production'),
  packageName: domainPackageNameSchema,
  publisher: domainPackagePublisherSchema.optional(),
  module: domainPackageModuleSchema,
  contributionContracts: z.record(
    domainPackageContributionIdSchema,
    domainPackageJsonValueSchema
  ).default({}),
  packaging: domainPackagePackagingSchema.optional(),
  entrypoints: z.array(domainPackageEntrypointSchema).min(1).max(3)
}).strict().superRefine((definition, context) => {
  validateDomainDefinitionOwnership(definition, context)
  const dependencies = definition.packaging?.runtime?.dependencies ?? []
  for (const [dependencyIndex, dependency] of dependencies.entries()) {
    if (dependency !== definition.packageName) continue
    context.addIssue({
      code: 'custom',
      path: ['packaging', 'runtime', 'dependencies', dependencyIndex],
      message: `Domain package ${definition.packageName} cannot depend on itself at runtime.`
    })
  }
})

export const sandboxedDomainPackageDefinitionSchema = z.object({
  contractVersion: z.literal(DOMAIN_PACKAGE_CONTRACT_VERSION),
  kind: z.literal('sandboxed-runtime'),
  packageName: domainPackageNameSchema,
  publisher: domainPackagePublisherSchema,
  module: domainPackageModuleSchema,
  requestedPermissions: z.array(domainPackageRequestedPermissionSchema).max(1_000),
  contributionContracts: z.record(
    domainPackageContributionIdSchema,
    domainPackageJsonValueSchema
  ).default({}),
  entrypoints: z.array(sandboxedDomainPackageEntrypointSchema).min(1).max(2)
}).strict().superRefine((definition, context) => {
  const processes = validateDomainDefinitionOwnership(definition, context)
  const permissionKeys = new Set<string>()
  for (const [permissionIndex, permission] of definition.requestedPermissions.entries()) {
    if (!processes.has(permission.process)) {
      context.addIssue({
        code: 'custom',
        path: ['requestedPermissions', permissionIndex, 'process'],
        message: `Permission ${permission.id} targets undeclared ${permission.process} entrypoint.`
      })
    }
    const key = `${permission.process}\u0000${permission.id}`
    if (permissionKeys.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['requestedPermissions', permissionIndex],
        message: `Duplicate ${permission.process} permission ${permission.id}.`
      })
    }
    permissionKeys.add(key)
  }
})

export const domainPackageDefinitionSchema = z.discriminatedUnion('kind', [
  trustedDomainPackageDefinitionSchema,
  sandboxedDomainPackageDefinitionSchema
])

export type DomainPackageHostApiRange = z.infer<typeof domainPackageHostApiRangeSchema>
export type DomainPackageModule = z.infer<typeof domainPackageModuleSchema>
export type DomainPackageContributionDeclaration = z.infer<
  typeof domainPackageContributionDeclarationSchema
>
export type DomainPackageContributionPublicReleasePolicy = z.infer<
  typeof domainPackageContributionPublicReleasePolicySchema
>
export type DomainPackageEntrypoint = z.infer<typeof domainPackageEntrypointSchema>
export type SandboxedDomainPackageEntrypoint = z.infer<
  typeof sandboxedDomainPackageEntrypointSchema
>
export type DomainPackagePublisher = z.infer<typeof domainPackagePublisherSchema>
export type DomainPackageRequestedPermission = z.infer<
  typeof domainPackageRequestedPermissionSchema
>
export type DomainPackageRuntimePackaging = z.infer<typeof domainPackageRuntimePackagingSchema>
export type DomainPackagePackaging = z.infer<typeof domainPackagePackagingSchema>
export type TrustedDomainPackageDefinition = z.infer<typeof trustedDomainPackageDefinitionSchema>
export type TrustedDomainPackageComposition = TrustedDomainPackageDefinition['composition']
export type TrustedDomainPackageDefinitionInput = z.input<typeof trustedDomainPackageDefinitionSchema>
export type SandboxedDomainPackageDefinition = z.infer<
  typeof sandboxedDomainPackageDefinitionSchema
>
export type SandboxedDomainPackageDefinitionInput = z.input<
  typeof sandboxedDomainPackageDefinitionSchema
>
export type DomainPackageDefinition = z.infer<typeof domainPackageDefinitionSchema>
export type DomainPackageDefinitionInput = z.input<typeof domainPackageDefinitionSchema>

export function defineDomainPackage(
  input: DomainPackageDefinitionInput
): DomainPackageDefinition {
  return deepFreeze(domainPackageDefinitionSchema.parse(input))
}

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

function validateDomainDefinitionOwnership(
  definition: Readonly<{
    packageName: string
    contributionContracts: Readonly<Record<string, DomainPackageJsonValue>>
    entrypoints: readonly Readonly<{
      process: DomainPackageProcess
      contributions: readonly DomainPackageContributionDeclaration[]
    }>[]
  }>,
  context: z.RefinementCtx
): ReadonlySet<DomainPackageProcess> {
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
  return processes
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
