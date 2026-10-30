import { z } from 'zod'
import { valid, validRange, satisfies as semverSatisfies } from './semver.mjs'
import { isCanonicalPluginPackageName } from './plugin-package-identity.mjs'
import { pluginWorkspacePreviewSlotSchema } from './workspace-preview-channel.js'

/** Exact package identity shared with the version store and isolated runner. */
export const pluginPackageNameSchema = z.string().refine(isCanonicalPluginPackageName, {
  message: 'Use a canonical lowercase package name.'
})

/** Exact approvals retain literal canonical identity; semver parsing never normalizes grants. */
export const pluginExactVersionSchema = z.string().refine(
  (value) => valid(value) !== null && !/^[v=\s]/u.test(value) && value.trim() === value,
  { message: 'Use a valid exact canonical semver version.' }
)

/** Bounded descriptive metadata shared by native DSH manifests and public extension summaries. */
export const pluginDescriptionSchema = z.string().max(4_000)

/** Native DSH package.json declaration. SciForge does not require a custom manifest file. */
export const dshBundleManifestSchema = z.object({ patch: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]) }).strict()
export const dshClientManifestSchema = z.object({ platform: z.string().min(1), inject: z.array(z.string().min(1)).optional(), immediately: z.boolean().optional(), external: z.array(z.string().min(1)).optional() }).strict()
export const dshProfileManifestSchema = z.object({ bundles: z.array(z.string().min(1)).optional() }).strict()
/** Preserve supplemental author metadata (e.g. marketplace); it never grants host permissions. */
export const dshManifestSchema = z.object({ manifestVersion: z.literal(1).optional(), bundle: dshBundleManifestSchema.optional(), profile: dshProfileManifestSchema.optional(), client: dshClientManifestSchema.optional() }).passthrough()
export const pluginManifestSchema = z.object({
  name: z.string().min(1), version: z.string().min(1), description: pluginDescriptionSchema.optional(), icon: z.string().optional(), private: z.boolean().optional(),
  dependencies: z.record(z.string(), z.string()).optional(), peerDependencies: z.record(z.string(), z.string()).optional(),
  engines: z.object({ dsh: z.string().min(1).optional() }).passthrough().optional(), dsh: dshManifestSchema
}).passthrough().superRefine((value, ctx) => { if (!value.dsh.bundle && !value.dsh.client && !value.dsh.profile) ctx.addIssue({ code: 'custom', message: 'DSH declaration must contain bundle, client, or profile.' }) })

export type NativeDshManifest = z.infer<typeof pluginManifestSchema>
/** Full npm range grammar; empty declarations are not compatibility contracts. */
export function isValidHostApiRange(value: string): boolean {
  return value.trim().length > 0 && validRange(value) !== null
}
export const hostApiRangeSchema = z.string().trim().min(1).refine(isValidHostApiRange, { message: 'Host API range must use valid semver range syntax.' })
/** Runtime view adds only derived safety metadata; serialized input remains native DSH. */
export type PluginManifest = NativeDshManifest
export const pluginPermissionIdSchema = z.string().trim().min(3).max(192)
export const pluginManifestSourceSchema = z.object({ repository: z.string().url().optional(), reference: z.string().trim().min(1).max(256).optional() }).strict()
export type PluginCompatibility = Readonly<{
  compatible: boolean
  dshRuntime: Readonly<{ status: 'compatible' | 'incompatible' | 'unknown'; required?: string; actual?: string; reason?: string }>
  hostApi: Readonly<{ status: 'compatible' | 'incompatible' | 'unknown' | 'adapter-required'; required?: string; actual?: string; reason?: string }>
  /** Legacy summary field retained for UI callers; it is true only when both checks pass. */
  reason?: string
}>
export type PluginPermissionCheck = Readonly<{
  status: 'approved' | 'denied' | 'unknown' | 'needs-approval'
  requested: readonly string[]
  approved: readonly string[]
  denied: readonly string[]
  allowed: boolean
  reason?: string
}>
/** Host-owned, version-bound authorization; never read from a plugin declaration. */
export type PluginDshAuthorization = Readonly<{ packageName: string; packageVersion: string; dshRuntimeVersion: string;
  /** Audited pure tools only; unknown tools/effects require a separate contract. */
  tools?: import('./process-extension-host.js').DshToolGrants;
  /** Private lifecycle data only, not a Broker tool file-write grant. */
  storage?: 'plugin-private';
  /** Host port operations approved for this exact package/runtime version pair. */
  ports?: readonly string[] }>
export type PluginAdapterContract = Readonly<{ hostApiRange: string; permissions: readonly string[]; approved?: boolean; dshAuthorization?: PluginDshAuthorization }>

export const pluginAdapterOperationSchema = z.object({
  effect: z.enum(['read', 'compute']).optional(),
  approval: z.enum(['none', 'system']).optional(),
  audiences: z.array(z.enum(['agent', 'system'])).optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional()
}).strict()

/** Plugin-owned SciForge adapter declaration. Approval is deliberately absent: the host owns approval. */
export const pluginAdapterDeclarationSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(['capability', 'renderer', 'managed-runtime', 'workflow', 'workspace-preview']),
  namespace: z.string().trim().min(1).max(128),
  hostApiRange: hostApiRangeSchema,
  permissions: z.array(pluginPermissionIdSchema).default([]),
  reloadPolicy: z.enum(['live', 'restart']),
  /** Renderer entry is host-served in a sandboxed iframe and is never executable in the main process. */
  ui: z.object({
    entry: z.string().trim().min(1).max(512),
    stateVersion: z.number().int().nonnegative().optional()
  }).strict().optional(),
  operations: z.record(z.string(), pluginAdapterOperationSchema).optional(),
  /**
   * Host-initiated workspace-preview slots (gap-1b channel). Only valid with
   * kind 'workspace-preview', where at least one slot is required; every other
   * kind must not declare preview slots.
   */
  previewSlots: z.array(pluginWorkspacePreviewSlotSchema).max(64).optional()
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'workspace-preview') {
    if (!value.previewSlots || value.previewSlots.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Workspace-preview adapters must declare at least one preview slot.' })
    }
  } else if (value.previewSlots !== undefined) {
    ctx.addIssue({ code: 'custom', message: `Adapter kind ${value.kind} must not declare preview slots.` })
  }
})

export type PluginAdapterDeclaration = z.infer<typeof pluginAdapterDeclarationSchema>

/** Host API and declared DSH engines use npm's default prerelease exclusion.
 * A prerelease is matched only by an explicit comparator for that version tuple.
 * Host-owned exact DSH approval without engines is a separate literal identity check. */
function satisfies(range: string | undefined, version: string): boolean {
  return range !== undefined && isValidHostApiRange(range) && valid(version) !== null && semverSatisfies(version, range)
}

export function parsePluginManifest(input: unknown): PluginManifest { return Object.freeze(pluginManifestSchema.parse(input)) }
export function checkPluginCompatibility(manifest: PluginManifest, options: Readonly<{ dshRuntimeVersion?: string; hostApiVersion?: string; adapter?: PluginAdapterContract }>): PluginCompatibility {
  const dshRequired = manifest.engines?.dsh
  const authorization = options.adapter?.dshAuthorization
  const authorizedRuntime = authorization !== undefined && options.adapter?.approved === true &&
    pluginExactVersionSchema.safeParse(authorization.packageVersion).success && pluginExactVersionSchema.safeParse(authorization.dshRuntimeVersion).success &&
    authorization.packageName === manifest.name && authorization.packageVersion === manifest.version &&
    authorization.dshRuntimeVersion === options.dshRuntimeVersion
  const dshRuntime = authorization !== undefined && !authorizedRuntime
    ? { status: 'incompatible' as const, reason: 'Host DSH authorization must approve this exact package version and fixed runtime version.' }
    : dshRequired === undefined && authorizedRuntime
    ? { status: 'compatible' as const, required: authorization.dshRuntimeVersion, actual: options.dshRuntimeVersion }
    : dshRequired === undefined || options.dshRuntimeVersion === undefined
    ? { status: 'unknown' as const, ...(dshRequired ? { required: dshRequired } : {}), ...(options.dshRuntimeVersion ? { actual: options.dshRuntimeVersion } : {}) }
    : satisfies(dshRequired, options.dshRuntimeVersion)
      ? { status: 'compatible' as const, required: dshRequired, actual: options.dshRuntimeVersion }
      : { status: 'incompatible' as const, required: dshRequired, actual: options.dshRuntimeVersion, reason: `Plugin ${manifest.name}@${manifest.version} requires DSH runtime ${dshRequired}; current runtime is ${options.dshRuntimeVersion}.` }
  const hostApi = options.adapter === undefined
    ? { status: 'adapter-required' as const, reason: 'DSH manifest has no SciForge Host API declaration; an approved adapter contract is required.' }
    : options.hostApiVersion === undefined
      ? { status: 'unknown' as const, required: options.adapter.hostApiRange }
      : satisfies(options.adapter.hostApiRange, options.hostApiVersion)
        ? { status: 'compatible' as const, required: options.adapter.hostApiRange, actual: options.hostApiVersion }
        : { status: 'incompatible' as const, required: options.adapter.hostApiRange, actual: options.hostApiVersion, reason: `Adapter requires SciForge Host API ${options.adapter.hostApiRange}; current host API is ${options.hostApiVersion}.` }
  const compatible = dshRuntime.status === 'compatible' && hostApi.status === 'compatible'
  return { compatible, dshRuntime, hostApi, ...(compatible ? {} : { reason: dshRuntime.reason ?? hostApi.reason ?? 'Plugin requires an approved compatible adapter contract.' }) }
}
export function checkPluginPermissions(manifest: PluginManifest, contract: PluginAdapterContract | undefined, approvedPermissionIds: ReadonlySet<string> = new Set()): PluginPermissionCheck {
  if (contract === undefined) return { status: 'needs-approval', allowed: false, requested: Object.freeze([]), approved: Object.freeze([]), denied: Object.freeze([]), reason: 'No SciForge adapter permission declaration or approval is available.' }
  const requested = Object.freeze([...contract.permissions])
  const approved = Object.freeze(requested.filter((permission) => approvedPermissionIds.has(permission)))
  const denied = Object.freeze(requested.filter((permission) => !approvedPermissionIds.has(permission)))
  if (contract.permissions.length === 0 && contract.approved === true) return { status: 'approved', allowed: true, requested, approved, denied }
  if (contract.approved !== true) return { status: 'needs-approval', allowed: false, requested, approved, denied, reason: 'Adapter permissions require explicit host approval before activation.' }
  if (denied.length > 0) return { status: 'denied', allowed: false, requested, approved, denied, reason: `Adapter permissions are not approved: ${denied.join(', ')}` }
  return { status: 'approved', allowed: true, requested, approved, denied }
}
export function manifestPermissionIds(_manifest: PluginManifest): readonly string[] { return Object.freeze([]) }
export function manifestContributionIds(_manifest: PluginManifest): readonly string[] { return Object.freeze([]) }
export function manifestMainEntry(manifest: PluginManifest): string | undefined { const e = (manifest as Record<string, unknown>).exports; if (e && typeof e === 'object') { const root = (e as Record<string, unknown>)['.']; if (typeof root === 'string') return root; if (root && typeof root === 'object') for (const key of ['default', 'import', 'node', 'require']) if (typeof (root as Record<string, unknown>)[key] === 'string') return (root as Record<string, unknown>)[key] as string } const main = (manifest as Record<string, unknown>).main; return typeof main === 'string' ? main : undefined }
export function manifestClientEntry(manifest: PluginManifest): string | undefined { const e = (manifest as Record<string, unknown>).exports; if (!e || typeof e !== 'object') return undefined; const client = (e as Record<string, unknown>)['./client']; if (typeof client === 'string') return client; if (client && typeof client === 'object') for (const key of ['default', 'import', 'browser']) if (typeof (client as Record<string, unknown>)[key] === 'string') return (client as Record<string, unknown>)[key] as string; return undefined }
