/**
 * Renderer-safe view of the plugin market. The renderer never sees an artifact
 * path, a publisher keyring or a policy file: it sees what a user may act on —
 * what is listed, what it would be granted, what is installed, and why something
 * cannot be installed yet.
 */

import { z } from 'zod'

/** The complete reviewed identity and grants; validated again against signed bytes. */
export const dshMarketApprovalToolSchema = z.object({
  name: z.string().trim().min(1).max(128),
  id: z.string().trim().min(1).max(192),
  effect: z.enum(['read', 'compute', 'workspace-write', 'external-write', 'destructive']),
  approval: z.enum(['none', 'confirmation']).optional(),
  scope: z.literal('workspace').optional(),
  readResource: z.literal('workspace').optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(16).optional()
}).strict()
export const dshMarketApprovalSnapshotSchema = z.object({
  packageName: z.string().trim().min(1).max(214),
  version: z.string().trim().min(1).max(64),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  publisher: z.string().trim().min(1).max(128).nullable(),
  entry: z.string().trim().min(1).max(1024),
  tools: z.array(dshMarketApprovalToolSchema).max(64),
  ports: z.array(z.string().trim().min(1).max(256)).max(32),
  hostDependencies: z.array(z.string().trim().min(1).max(214)).max(64)
}).strict()
export type DshMarketApprovalSnapshot = z.infer<typeof dshMarketApprovalSnapshotSchema>

export function normalizeDshMarketApproval(value: DshMarketApprovalSnapshot): DshMarketApprovalSnapshot {
  const snapshot = dshMarketApprovalSnapshotSchema.parse(value)
  const tools = snapshot.tools.map(tool => ({
    name: tool.name, id: tool.id, effect: tool.effect,
    approval: tool.effect === 'external-write' || tool.effect === 'destructive' ? 'confirmation' as const : tool.approval ?? 'none' as const,
    ...(tool.scope ? { scope: tool.scope } : {}),
    ...(tool.readResource ? { readResource: tool.readResource } : {}),
    tags: [...(tool.tags ?? [])].sort()
  })).sort((a, b) => a.name.localeCompare(b.name))
  if (new Set(tools.map(tool => tool.name)).size !== tools.length
    || new Set(snapshot.ports).size !== snapshot.ports.length
    || new Set(snapshot.hostDependencies).size !== snapshot.hostDependencies.length) {
    throw new Error('Approval snapshot contains duplicate grants or dependencies.')
  }
  return { ...snapshot, tools, ports: [...snapshot.ports].sort(), hostDependencies: [...snapshot.hostDependencies].sort() }
}

export type DshMarketToolEffect =
  | 'read'
  | 'compute'
  | 'workspace-write'
  | 'external-write'
  | 'destructive'

export type DshMarketTool = Readonly<{
  name: string
  id: string
  effect: DshMarketToolEffect
  approval?: 'none' | 'confirmation'
  scope?: 'workspace'
  readResource?: 'workspace'
  tags?: readonly string[]
}>

export type DshMarketCapability = Readonly<{
  name: string
  id: string
  effect: DshMarketToolEffect
  /** True when the Host currently exposes this capability (installed and enabled). */
  registered: boolean
}>

export type DshMarketPlugin = Readonly<{
  approvalSnapshot: DshMarketApprovalSnapshot
  name: string
  title: string
  version: string
  categories: readonly string[]
  tools: readonly DshMarketTool[]
  /** How to actually use it: the capabilities, and whether they are live right now. */
  capabilities: readonly DshMarketCapability[]
  /** Requested Host operations, shown for explicit installation approval. */
  ports: readonly string[]
  hostDependencies: readonly string[]
  publisher: string | null
  sizeBytes: number
  sha256: string
  /** Why it cannot be called for real yet, when that is known. */
  runtimeNote: string | null
  installed: boolean
  enabled: boolean
  installedVersion: string | null
}>

export type DshMarketBlockedPlugin = Readonly<{
  name: string
  plugin: string
  version: string
  reason: string
  detail: string | null
  runtimeGap: string | null
}>

export type DshMarketView = Readonly<{
  source: Readonly<{ kind: 'file' | 'url'; location: string }> | null
  generatedAt: string | null
  dshRuntimeVersion: string | null
  plugins: readonly DshMarketPlugin[]
  notInstallable: readonly DshMarketBlockedPlugin[]
  /** Set when the catalog could not be read; the market then shows nothing usable. */
  error: string | null
}>

export type DshMarketInstallPhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'activating'
  | 'done'
  | 'failed'

export type DshMarketProgress = Readonly<{
  packageName: string
  phase: DshMarketInstallPhase
  bytesReceived: number | null
  bytesTotal: number | null
  message: string | null
}>

export type DshMarketInstallResult = Readonly<{
  packageName: string
  version: string
  sha256: string
  tools: readonly string[]
}>

export type DshMarketInstallInput = Readonly<{
  packageName: string
  approvalSnapshot: DshMarketApprovalSnapshot
  /** Exactly the tools the user approved; the host refuses anything else. */
  approvedToolNames: readonly string[]
  /** Only Host operations explicitly checked by the user. */
  approvedPorts?: readonly string[]
}>

export type DshMarketPackageInput = Readonly<{ packageName: string }>

export type DshMarketSetEnabledInput = Readonly<{ packageName: string; enabled: boolean }>

export type DshMarketApi = Readonly<{
  list: () => Promise<DshMarketView>
  install: (input: DshMarketInstallInput) => Promise<DshMarketInstallResult>
  uninstall: (input: DshMarketPackageInput) => Promise<void>
  setEnabled: (input: DshMarketSetEnabledInput) => Promise<DshMarketPlugin>
  /** Latest phase of the running install, or null when nothing is running. */
  progress: (input?: DshMarketPackageInput) => Promise<DshMarketProgress | null>
}>