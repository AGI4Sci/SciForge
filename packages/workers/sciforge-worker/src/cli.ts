/** SSH stdio entrypoint for the lightweight SciForge worker. */
import { requireWorkspaceHostBundledCodexExecutable, createWorkspaceHostDomainComposition, createWorkspaceHostPreviewOperation, WorkspaceHostJsonlServer, WorkspaceHostService } from '@sciforge/workspace-host'
import { createCodexWorkspaceHostRuntime } from '@sciforge/codex-runtime/workspace-host'
import { workspaceHostLifecycleModeSchema, workspaceNetworkEgressStateSchema } from '@sciforge/domain-sdk/workspace-host'

const root = decodeBase64Url(required('--workspace-root-base64'))
const lifecycleMode = workspaceHostLifecycleModeSchema.parse(optional('--lifecycle-mode') ?? 'connection-session')
if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('SciForge Worker currently requires a Linux x64 host.')
}
const codex = await requireWorkspaceHostBundledCodexExecutable(import.meta.dirname)
const composition = createWorkspaceHostDomainComposition({ log: e => process.stderr.write(`[worker:${e.level}] ${e.message}\n`) })
try {
  const preview = createWorkspaceHostPreviewOperation(composition.contributions)
  const runtime = await createCodexWorkspaceHostRuntime({ workspaceRoot: root, command: codex })
  try {
    const service = await WorkspaceHostService.create({ workspaceRoot: root, lifecycleMode, lifecycleReason: 'SciForge Worker owns this authenticated SSH session.', operationHandlers: [...runtime.operationHandlers, ...(preview ? [preview] : [])] })
    const egressMode = optional('--egress-mode') ?? 'none'
    const egressState = workspaceNetworkEgressStateSchema.parse({ mode: egressMode, status: optional('--egress-status') ?? (egressMode === 'none' ? 'disabled' : 'unavailable') })
    await new WorkspaceHostJsonlServer({ service, input: process.stdin, output: process.stdout, contributions: composition.cohorts, egressState, disposeServiceOnClose: true }).run()
  } finally { await runtime.dispose() }
} finally { composition.dispose() }

function optional(flag: string): string | undefined { const i = process.argv.indexOf(flag); return i < 0 ? undefined : process.argv[i + 1] }
function required(flag: string): string { const v = optional(flag); if (!v || v.startsWith('--')) throw new Error(`Missing required ${flag}.`); return v }
function decodeBase64Url(value: string): string { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Workspace root must use unpadded base64url encoding.'); const decoded = Buffer.from(value, 'base64url').toString('utf8'); if (!decoded || decoded.includes('\0')) throw new Error('Workspace root is invalid.'); return decoded }
