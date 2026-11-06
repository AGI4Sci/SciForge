import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createDevBrowserBridgeRuntime } from '../src/main/capability-eval/dev-bridge-runtime.js'

const runtime = JSON.parse(await readFile('.cache/visual-acceptance/runtime.json', 'utf8'))
const clientId = `visual-agent-${randomUUID()}`
const bridgeUrl = `http://127.0.0.1:${runtime.bridgePort}`
const bridge = await createDevBrowserBridgeRuntime({ bridgeUrl, instanceId: runtime.instanceId, clientId })
const thread = process.env.SCIFORGE_ACCEPTANCE_RESUME === '1'
  ? JSON.parse(await readFile(`${runtime.root}/thread.json`, 'utf8'))
  : await bridge.startThread({ runtimeId: 'dsh', workspace: runtime.workspace, title: 'Unified figures actual DeepSeek acceptance' })
await writeFile(`${runtime.root}/thread.json`, JSON.stringify(thread, null, 2))
const previous = process.env.SCIFORGE_ACCEPTANCE_RESUME === '1'
  ? JSON.parse(await readFile(`${runtime.root}/agent-turn-evidence.json`, 'utf8')) : undefined
const sinceSeq = previous?.finished?.seq ?? 0
const events = []
const controller = new AbortController()
let terminalResolve
const terminal = new Promise(resolve => { terminalResolve = resolve })
const consumer = (async () => {
  for await (const event of bridge.subscribeEvents({ runtimeId: 'dsh', threadId: thread.id, sinceSeq, signal: controller.signal })) {
    events.push(event)
    console.log(JSON.stringify({ kind: event.kind, seq: event.seq, name: event.name ?? event.toolName, status: event.status }))
    if (event.kind === 'approval_requested') {
      // Acceptance is authorized only through an actual UI click and Host dialog;
      // this Agent evidence collector never manufactures an approval.
      await bridge.resolveApproval({ runtimeId: 'dsh', threadId: thread.id, approvalId: event.approvalId, decision: 'denied' })
    }
    if ((event.kind === 'turn_lifecycle' && ['completed', 'failed', 'cancelled', 'aborted'].includes(event.state)) || ['turn_completed', 'turn_failed', 'turn_cancelled', 'turn_aborted', 'error'].includes(event.kind)) terminalResolve(event)
  }
})()
// subscribeEvents establishes its stream asynchronously; the request below goes
// through the same client and the durable Host history also captures early events.
const text = process.env.SCIFORGE_ACCEPTANCE_TEXT ?? 'Use the installed scientific_figures tool (scientific-figures.operation) in the current workspace to produce a real line chart: x=[0,1,2,3], y=[1,2,4,8], title Test exponential response. Discover its actual contract first. Use action saveCode to save an immutable Python snapshot, action executePython to run it under the session sandbox, and action readRun to inspect the completed record and exact output paths. Save the PNG under SCIENTIFIC_FIGURES_OUTPUT_DIR. Then use action publishRun with the returned runId/outputPath, a fresh documentId and operationId, expectedDocumentRevision=0, and action read to verify the document. Use only action/input in the tool arguments; never supply workspaceRoot or approvalGranted. If execution confinement is unavailable, report that failure and stop. Do not accept a candidate. Report only the verified documentId, currentRevisionId, runId, codeRevisionId and workspace-relative PNG path. Do not use shell/file tools to bypass the plugin.'
try {
  const handle = await bridge.startTurn({ runtimeId: 'dsh', threadId: thread.id, workspace: runtime.workspace, text })
  console.log(JSON.stringify({ started: handle }))
  const deadline = setTimeout(() => terminalResolve({ kind: 'acceptance_timeout' }), 600_000)
  const finished = await terminal
  clearTimeout(deadline)
  const response = await fetch(`${bridgeUrl}/invoke`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SciForge-Dev-Instance': runtime.instanceId, 'X-SciForge-Client': clientId }, body: JSON.stringify({ channel: 'agentRuntime:readThreadPage', payload: { runtimeId: 'dsh', threadId: thread.id, limit: 60 } }) })
  const page = await response.json()
  await writeFile(`${runtime.root}/agent-turn-evidence.json`, JSON.stringify({ thread, handle, finished, events, page }, null, 2))
  console.log(JSON.stringify({ finished, evidence: `${runtime.root}/agent-turn-evidence.json` }))
} finally {
  controller.abort()
  await consumer.catch(() => undefined)
  await bridge.close()
}
