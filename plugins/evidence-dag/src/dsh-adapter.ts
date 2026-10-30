import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { canonicalParameters } from './tool-schema.js'
import { evidenceDagUpdateInputSchema, evidenceDagSealClosureInputSchema, evidenceDagSidechainAppendInputSchema, evidenceDagExportSnapshotProductsInputSchema } from './core.js'
import type { Context } from '@deepseek-ai/cordis'
import { EvidenceRuntime } from './runtime.js'
import { PORTS_SERVICE, type EvidencePorts, type Scope } from '@sciforge/domain-evidence-dag/host/ports'
export const name = 'sciforge-evidence-dag'
export const inject = ['tools', PORTS_SERVICE]
/** Fixed 0.2.0-rc.2 DSH entry. evidenceDagPorts is an explicit Host extension requirement. */
export async function apply(ctx: Context) {
  const ports = ctx.get(PORTS_SERVICE) as EvidencePorts | undefined
  if (!ports?.request || !ports.cancel || !ports.storageRoot) throw new Error('Evidence DAG requires approved evidenceDagPorts v1 service.')
  let runtime: EvidenceRuntime | undefined
  const writer = () => runtime ??= new EvidenceRuntime(ports)
  // Activation and committed reads must never acquire the writable store.
  let started: Promise<void> | undefined
  const withWriter = async <T>(callId: string, signal: AbortSignal, action: () => Promise<T>) => {
    await (started ??= writer().start())
    return writer().withInvocation({ callId }, signal, action)
  }
  ctx.effect(() => async () => { if (started) { await started; await writer().close() } })
  const scopeSchema = evidenceDagUpdateInputSchema.extend({ workspaceRoot: evidenceDagUpdateInputSchema.shape.workspaceRoot.unwrap() })
  const parameters = canonicalParameters(scopeSchema)
  for (const [name, description, execute] of [
    ['evidence_dag_update', 'Append a durable Evidence delta from the authorized artifact projection.', (scope: Scope) => writer().update(scope)],
  ] as const) {
    ctx.tools.register(defineTool({ name, description, parameters,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, exec) => JSON.parse(JSON.stringify(await withWriter<unknown>(exec.callId, exec.signal, () => execute(scopeSchema.parse(args))))),
    }))
  }
  ctx.tools.register(defineTool({
    name: 'evidence_dag_snapshot_status', description: 'Read exact committed Evidence and immutable closure without an ordinary Session or writer.', parameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const requestId = randomUUID()
      const abort = () => { void ports.cancel(requestId) }
      exec.signal.addEventListener('abort', abort, { once: true })
      try {
        const result = await ports.request({ protocol: 'sciforge-evidence-ports.v1', identity: ports.identity, requestId, caller: { callId: exec.callId }, operation: 'committed.status', scope: scopeSchema.parse(args), input: {} })
        exec.signal.throwIfAborted()
        return JSON.parse(JSON.stringify(result))
      } finally { exec.signal.removeEventListener('abort', abort) }
    }
  }))
  ctx.tools.register(defineTool({
    name: 'evidence_dag_seal_closure', description: 'Seal an exact durable Evidence closure and verify its immutable Python Snapshot.',
    parameters: canonicalParameters(evidenceDagSealClosureInputSchema.extend({ workspaceRoot: evidenceDagSealClosureInputSchema.shape.workspaceRoot.unwrap() })),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => JSON.parse(JSON.stringify(await withWriter(exec.callId, exec.signal, () => writer().sealClosure(args as Parameters<EvidenceRuntime['sealClosure']>[0])))),
  }))
  ctx.tools.register(defineTool({
    name: 'evidence_dag_append_sidechain', description: 'Append an idempotent review/audit record against one sealed Evidence closure.',
    parameters: canonicalParameters(z.object({ input: evidenceDagSidechainAppendInputSchema.extend({ workspaceRoot: evidenceDagSidechainAppendInputSchema.shape.workspaceRoot.unwrap() }) })),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => JSON.parse(JSON.stringify(await withWriter(exec.callId, exec.signal, () => writer().appendSidechain(args.input as Parameters<EvidenceRuntime['appendSidechain']>[0])))),
  }))
  ctx.tools.register(defineTool({
    name: 'evidence_dag_export_snapshot_products', description: 'Export five products from a pinned committed Snapshot through one authoritative Artifact Versions transaction.',
    parameters: canonicalParameters(z.object({ input: evidenceDagExportSnapshotProductsInputSchema.extend({ workspaceRoot: evidenceDagExportSnapshotProductsInputSchema.shape.workspaceRoot.unwrap() }) })),
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => JSON.parse(JSON.stringify(await withWriter(exec.callId, exec.signal, () => writer().exportSnapshotProducts(args.input as Parameters<EvidenceRuntime['exportSnapshotProducts']>[0])))),
  }))
  ctx.tools.register(defineTool({
    name: 'evidence_dag_poll_artifact_events', description: 'Drain authorized Artifact Versions lifecycle events through the persistent Evidence outbox/cursor.', parameters,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => { await withWriter(exec.callId, exec.signal, () => writer().pollArtifactEvents(scopeSchema.parse(args))); return { drained: true } },
  }))
}
