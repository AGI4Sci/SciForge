import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { z } from 'zod'
import { dshToolGrantSchema, hostApiRangeSchema, pluginExactVersionSchema, pluginHostServicesSchema, pluginPackageNameSchema, type PluginAdapterContract } from '@sciforge/plugin-sdk'
import type { DevelopmentExternalPluginService } from './development-external-plugins'
import { ensureDshAgentResolverModule } from './dsh-agent-resolver'

type ServiceOptions = ConstructorParameters<typeof DevelopmentExternalPluginService>[0]
// This development seam is Host-owned: every tool effect still requires an exact grant.
// Keep scope semantics aligned with artifact admission: workspace binding and
// resource handles are alternative lanes, and local writes require binding.
const developmentToolGrantSchema = dshToolGrantSchema
  .refine(grant => grant.readResource === undefined || grant.effect === 'read', 'readResource requires read effect')
  .refine(grant => grant.scope === undefined || grant.readResource === undefined, 'workspace scope and a read resource are mutually exclusive')
  .refine(grant => (grant.effect !== 'workspace-write' && grant.effect !== 'destructive') || grant.scope === 'workspace', "workspace-write and destructive grants must declare scope: 'workspace'")

const contractSchema = z.object({
  hostApiRange: hostApiRangeSchema, permissions: z.array(z.never()), approved: z.boolean(),
  dshAuthorization: z.object({
    packageName: pluginPackageNameSchema, packageVersion: pluginExactVersionSchema, dshRuntimeVersion: pluginExactVersionSchema,
/** G7 exemption: approved to run with no Host service clients at all. */
    hostServices: pluginHostServicesSchema.optional(),
    tools: z.record(z.string().min(1), developmentToolGrantSchema).optional(),
    storage: z.literal('plugin-private').optional(),
    /** Host port operations approved for this exact package/runtime version pair. */
    ports: z.array(z.string().trim().min(1)).max(32).optional()
  }).strict(),
  /** Plain UI capabilities this plugin's panel may invoke beyond its own tools. */
  uiCapabilities: z.array(z.string().trim().min(1).max(192)).max(64).optional(),
  /** Resource kinds this plugin's panel can display. */
  uiResourceKinds: z.array(z.string().trim().min(1).max(128)).max(32).optional()
}).strict()

/** Host-owned development configuration; packaged applications never read this seam.
 * The file serializes the existing SDK contract, not a plugin manifest or a second grant API.
 * Authorization edits take effect after application restart; runtime checks still fail closed.
 */
export async function loadDevelopmentPluginOptions(input: Readonly<{
  isPackaged: boolean
  userDataPath: string
  hostApiVersion: string
  env: Readonly<Record<string, string | undefined>>
}>): Promise<ServiceOptions | undefined> {
  const root = input.env.SCIFORGE_DEV_PLUGIN_ROOT?.trim()
  if (input.isPackaged || !root) return undefined
  if (!isAbsolute(root)) throw new Error('Development plugin root must be absolute.')
  const adapterContracts = new Map<string, PluginAdapterContract>()
  const path = input.env.SCIFORGE_DEV_PLUGIN_CONTRACTS?.trim()
  if (path) {
    if (!isAbsolute(path)) throw new Error('Host contract file must be absolute.')
    const [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(path)])
    const location = relative(canonicalRoot, canonicalPath)
    if (!location || (!location.startsWith(`..${sep}`) && location !== '..' && !isAbsolute(location))) {
      throw new Error('Host approval contracts must be outside the development plugin root.')
    }
    const contracts = z.array(contractSchema).parse(JSON.parse(await readFile(canonicalPath, 'utf8')))
    for (const contract of contracts) {
      const name = contract.dshAuthorization.packageName
      const versionKey = `${name}@${contract.dshAuthorization.packageVersion}`
      if (adapterContracts.has(versionKey)) throw new Error(`Duplicate host contract: ${versionKey}`)
      adapterContracts.set(versionKey, contract)
    }
  }
  return { root, userDataPath: input.userDataPath, hostApiVersion: input.hostApiVersion,
    dshRuntimeVersion: input.env.SCIFORGE_DSH_RUNTIME_VERSION?.trim() || undefined,
    adapterContracts, allowedPermissionIds: new Set(),
    ...(input.env.SCIFORGE_DEV_PLUGIN_RUNTIME_ENV_JSON ? { pluginRuntimeEnv: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string()).parse(JSON.parse(input.env.SCIFORGE_DEV_PLUGIN_RUNTIME_ENV_JSON)) } : {}),
    // G9: ordinary-Session invocations need the child-local ordinary Agent resolver.
    dshAgentResolver: await ensureDshAgentResolverModule(input.userDataPath) }
}
