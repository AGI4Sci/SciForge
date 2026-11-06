import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { pluginHostServicesSchema, type PluginAdapterContract } from '@sciforge/plugin-sdk'
import { dshPluginPortOperationsSchema, dshPluginToolGrantSchema } from './dsh-plugin-artifact'

/**
 * Host-owned approval policy for installed DSH runtime plugins.
 *
 * The market catalog only *offers* a plugin; it never grants anything. An
 * artifact only *declares* the tools it wants. The only thing that turns a
 * declaration into a grant is an entry here, written by the host after it has
 * verified the artifact's digests and the user has approved the requested tool
 * list. This file is the single source of adapter contracts for the installed
 * plugin root, so the extension host, discovery and the install path all read
 * the same approvals.
 */

export const DSH_PLUGIN_POLICY_FILE_NAME = 'dsh-plugin-policy.json'

const packageNamePattern = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const exactVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

export const dshPluginPolicyEntrySchema = z.object({
  packageName: z.string().trim().min(1).max(214).regex(packageNamePattern),
  version: z.string().trim().max(64).regex(exactVersionPattern),
  dshRuntimeVersion: z.string().trim().min(1).max(128),
  hostApiRange: z.string().trim().min(1).max(128),
  /** Directory digest of the approved plugin directory (content identity, not publisher identity). */
  integrity: z.string().regex(/^[0-9a-f]{64}$/),
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
  tools: z.record(z.string().trim().min(1).max(128), dshPluginToolGrantSchema),
  /** G7 exemption recorded with the approved policy entry. */
  hostServices: pluginHostServicesSchema.optional(),
  /** Digest-verified requests retained for Host review, never implicit grants. */
  declaredPorts: dshPluginPortOperationsSchema.optional(),
  /** Only operations explicitly approved by the user, not artifact declarations. */
  ports: dshPluginPortOperationsSchema.optional(),
  /** Bare packages the artifact declared as host-provided; the host decides. */
  hostDependencies: z.array(z.string().trim().min(1).max(214)).max(64),
  /** Trusted publisher that signed the artifact; null only for an explicitly allowed unsigned install. */
  publisherId: z.string().trim().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/).nullable(),
  approvedAt: z.string().trim().min(1).max(64),
  source: z.string().trim().min(1).max(1_024)
}).strict().refine((entry) => entry.hostServices !== 'none' || (!entry.ports?.length && !entry.declaredPorts?.length), {
  path: ['ports'], message: 'hostServices: none conflicts with ports'
}).refine((entry) => !entry.ports?.length || entry.ports.every((port) => entry.declaredPorts?.includes(port)), {
  path: ['ports'], message: 'approved ports must be declared'
})

export const dshPluginPolicySchema = z.object({
  schemaVersion: z.literal(1),
  approved: z.array(dshPluginPolicyEntrySchema).max(1_024)
}).strict()

export type DshPluginPolicyEntry = z.infer<typeof dshPluginPolicyEntrySchema>
export type DshPluginPolicy = z.infer<typeof dshPluginPolicySchema>

export function emptyDshPluginPolicy(): DshPluginPolicy {
  return { schemaVersion: 1, approved: [] }
}

export function resolveDshPluginPolicyPath(userDataPath: string): string {
  return resolve(userDataPath, 'extensions', DSH_PLUGIN_POLICY_FILE_NAME)
}

export async function readDshPluginPolicy(path: string): Promise<DshPluginPolicy> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDshPluginPolicy()
    throw error
  }
  const parsed = dshPluginPolicySchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(
      `The DSH plugin policy at ${path} is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    )
  }
  return parsed.data
}

export async function writeDshPluginPolicy(path: string, policy: DshPluginPolicy): Promise<void> {
  const validated = dshPluginPolicySchema.parse(policy)
  const entries = [...validated.approved].sort((left, right) =>
    `${left.packageName}@${left.version}`.localeCompare(`${right.packageName}@${right.version}`)
  )
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, approved: entries }, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export function policyEntryFor(
  policy: DshPluginPolicy,
  packageName: string,
  version: string
): DshPluginPolicyEntry | undefined {
  return policy.approved.find((entry) => entry.packageName === packageName && entry.version === version)
}

export function upsertPolicyEntry(policy: DshPluginPolicy, entry: DshPluginPolicyEntry): DshPluginPolicy {
  const others = policy.approved.filter(
    (candidate) => !(candidate.packageName === entry.packageName && candidate.version === entry.version)
  )
  return { schemaVersion: 1, approved: [...others, entry] }
}

export function removePolicyEntry(policy: DshPluginPolicy, packageName: string): DshPluginPolicy {
  return {
    schemaVersion: 1,
    approved: policy.approved.filter((entry) => entry.packageName !== packageName)
  }
}

/**
 * Turns approved policy entries into the adapter contracts the extension host
 * expects. A contract is only produced for an exact package@version pair, with
 * the recorded DSH runtime version, so a policy entry can never authorize a
 * different version than the one that was reviewed.
 */
export function policyContracts(policy: DshPluginPolicy): Map<string, PluginAdapterContract> {
  const contracts = new Map<string, PluginAdapterContract>()
  for (const entry of dshPluginPolicySchema.parse(policy).approved) {
    contracts.set(
      `${entry.packageName}@${entry.version}`,
      Object.freeze({
        hostApiRange: entry.hostApiRange,
        permissions: Object.freeze([]) as readonly string[],
        approved: true,
        dshAuthorization: Object.freeze({
          packageName: entry.packageName,
          packageVersion: entry.version,
          dshRuntimeVersion: entry.dshRuntimeVersion,
          ...(entry.hostServices !== undefined ? { hostServices: entry.hostServices } : {}),
          ...(entry.ports !== undefined ? { ports: Object.freeze([...entry.ports]) } : {}),
          tools: entry.tools
        })
      })
    )
  }
  return contracts
}
