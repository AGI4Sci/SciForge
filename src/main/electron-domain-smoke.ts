import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { app } from 'electron'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createExecutionReceipt } from '@sciforge/execution-governance'
import type { AgentRuntimeToolEvent } from '../shared/agent-runtime-contract'
import {
  agentVisualCaptureOutputSchema,
  agentVisualLookOutputSchema
} from '../shared/agent-visual'
import type {
  CapabilityAgentToolRequestContext,
  CapabilityAgentToolSurface
} from './capabilities/agent-tools'
import type { AgentRuntimeToolTurnIdentity } from './runtime/agent-runtime/agent-tool-surface'
import { nativeAgentToolExecutionMetadata } from './runtime/agent-runtime/agent-tool-surface'
import { RuntimeExecutionIntegrityGuard } from './runtime/agent-runtime/execution-integrity-guard'
import {
  createCodexPreToolUseHookDefinition,
  probeCodexPreToolUseHook,
  type CodexPreToolUseHookProbeResult
} from './runtime/codex/codex-pre-tool-use-hook'

const FIXTURE_WIDTH = 160
const FIXTURE_HEIGHT = 100
const REGION = Object.freeze({ x: 0.25, y: 0.2, width: 0.5, height: 0.6 })
const EXPECTED_CAPTURE_WIDTH = FIXTURE_WIDTH * REGION.width
const EXPECTED_CAPTURE_HEIGHT = FIXTURE_HEIGHT * REGION.height
const SMOKE_TOOL_TURN = Object.freeze({
  runtimeId: 'codex',
  threadId: 'electron-domain-smoke-thread',
  turnId: 'electron-domain-smoke-turn'
}) satisfies AgentRuntimeToolTurnIdentity

export type ElectronDomainNativeVisualSmokeInput = Readonly<{
  workspaceDirectory: string
}>

export type ElectronDomainNativeVisualSmokeResult = Readonly<{
  toolNames: string[]
  artifactRelativePath: string
  artifactSha256: string
  captureWidth: number
  captureHeight: number
  cropped: boolean
  datasetLoopCapabilitiesDiscoverable: boolean
  nativeImageBindingValidated: boolean
  proofChainValidated: boolean
  unavailableRouteFailedVisibly: boolean
}>

type ElectronDomainNativeVisualSmokeDriver = (
  input: ElectronDomainNativeVisualSmokeInput
) => Promise<ElectronDomainNativeVisualSmokeResult>

type ElectronDomainCodexHookSmokeDriver = (
  input: ElectronDomainNativeVisualSmokeInput
) => Promise<CodexPreToolUseHookProbeResult>

declare global {
  // Playwright's Electron smoke evaluates this private, main-process-only
  // callback. It is installed only for the canonical Electron smoke launch.
  var __SCIFORGE_ELECTRON_DOMAIN_NATIVE_VISUAL_SMOKE__:
    | ElectronDomainNativeVisualSmokeDriver
    | undefined
  var __SCIFORGE_ELECTRON_DOMAIN_CODEX_HOOK_SMOKE__:
    | ElectronDomainCodexHookSmokeDriver
    | undefined
}

export function installElectronDomainNativeVisualSmoke(
  agentTools: CapabilityAgentToolSurface,
  withPrincipalLease: <T>(
    identity: AgentRuntimeToolTurnIdentity,
    operation: () => Promise<T>
  ) => Promise<T>
): void {
  if (process.env.SCIFORGE_ELECTRON_SMOKE !== '1') return
  globalThis.__SCIFORGE_ELECTRON_DOMAIN_NATIVE_VISUAL_SMOKE__ = async (input) =>
    withPrincipalLease(SMOKE_TOOL_TURN, () =>
      runElectronDomainNativeVisualSmoke(agentTools, input)
    )
  globalThis.__SCIFORGE_ELECTRON_DOMAIN_CODEX_HOOK_SMOKE__ = async (input) => {
    const workspaceDirectory = resolveWorkspaceDirectory(input.workspaceDirectory)
    return probeCodexPreToolUseHook({
      definition: createCodexPreToolUseHookDefinition({
        codexHome: join(workspaceDirectory, '.codex-hook-smoke'),
        launch: {
          appPath: app.getAppPath(),
          execPath: process.execPath,
          isPackaged: app.isPackaged
        }
      }),
      cwd: workspaceDirectory,
      storageRoot: workspaceDirectory
    })
  }
}

async function runElectronDomainNativeVisualSmoke(
  agentTools: CapabilityAgentToolSurface,
  input: ElectronDomainNativeVisualSmokeInput
): Promise<ElectronDomainNativeVisualSmokeResult> {
  const workspaceDirectory = resolveWorkspaceDirectory(input.workspaceDirectory)
  await mkdir(workspaceDirectory, { recursive: true })
  const fixtureRelativePath = 'native-visual-smoke-fixture.png'
  const fixturePath = join(workspaceDirectory, fixtureRelativePath)
  await writeFile(fixturePath, fixturePng())

  const toolNames = agentTools.tools().map((tool) => tool.name)
  const discoveredToolNames = new Set<string>(toolNames)
  for (const required of ['sciforge_look', 'sciforge_capture']) {
    if (!discoveredToolNames.has(required)) {
      throw new Error(`Native visual smoke could not discover ${required}.`)
    }
  }

  const { runtimeId, threadId, turnId } = SMOKE_TOOL_TURN
  const context = {
    runtimeId,
    threadId,
    turnId,
    workspaceId: workspaceDirectory
  }
  for (const capabilityId of ['create-loop.build-dataset', 'dataset-api.materialize']) {
    const discovered = await agentTools.call({
      name: 'sciforge_discover',
      arguments: { capabilityId, includeSchema: true, limit: 1 },
      context: {
        ...context,
        requestId: `electron-domain-smoke-discover-${capabilityId}`,
        callId: `electron-domain-smoke-discover-${capabilityId}`
      }
    })
    if (discovered.tool !== 'sciforge_discover' || discovered.value.length !== 1) {
      throw new Error(`Native agent capability discovery could not find ${capabilityId}.`)
    }
  }
  const sourceRef = await openWorkspaceVisualSource(
    agentTools,
    fixtureRelativePath,
    workspaceDirectory,
    context
  )
  const guard = new RuntimeExecutionIntegrityGuard()
  guard.rememberTurn(runtimeId, {
    runtimeId,
    threadId,
    text: 'Capture the located fixture target and verify the persisted result.',
    displayText: 'Capture the located fixture target and verify the persisted result.',
    workspace: workspaceDirectory,
    executionIntent: {
      mode: 'execute',
      requirements: [
        {
          id: 'visual-look-locate',
          receiptKind: 'visual.look'
        },
        {
          id: 'visual-capture',
          receiptKind: 'visual.capture',
          requiresRegionRef: true,
          dependsOn: ['visual-look-locate']
        },
        {
          id: 'visual-look-final',
          receiptKind: 'visual.look',
          dependsOn: ['visual-capture']
        }
      ]
    }
  }, threadId, turnId)

  const locateCallId = 'electron-domain-smoke-look-locate'
  const lookedResult = await agentTools.call({
    name: 'sciforge_look',
    arguments: {
      sourceRef,
      task: 'Locate the colored fixture target.',
      intent: 'locate'
    },
    context: { ...context, requestId: locateCallId, callId: locateCallId }
  })
  const looked = agentVisualLookOutputSchema.parse(lookedResult.value)
  const regionRef = looked.regions[0]?.regionRef
  if (!regionRef) throw new Error('Native visual smoke did not receive a target region.')
  observeToolResult(guard, runtimeId, threadId, turnId, locateCallId, lookedResult)

  const captureCallId = 'electron-domain-smoke-capture'
  const capturedResult = await agentTools.call({
    name: 'sciforge_capture',
    arguments: {
      snapshotRef: looked.snapshotRef,
      regionRef,
      purpose: 'visual-evidence'
    },
    context: { ...context, requestId: captureCallId, callId: captureCallId }
  })
  const captured = agentVisualCaptureOutputSchema.parse(capturedResult.value)
  observeToolResult(guard, runtimeId, threadId, turnId, captureCallId, capturedResult)

  const artifactPath = resolve(workspaceDirectory, captured.relativePath)
  if (relative(workspaceDirectory, artifactPath).startsWith('..')) {
    throw new Error('Native visual smoke persisted outside the workspace.')
  }
  const artifactBytes = await readFile(artifactPath)
  if (!artifactBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Native visual smoke did not persist a PNG artifact.')
  }
  if (createHash('sha256').update(artifactBytes).digest('hex') !== captured.sha256) {
    throw new Error('Native visual smoke artifact digest did not match its capture proof.')
  }
  const decoded = await loadImage(artifactBytes)
  if (decoded.width !== EXPECTED_CAPTURE_WIDTH || decoded.height !== EXPECTED_CAPTURE_HEIGHT) {
    throw new Error(
      `Native visual smoke captured ${decoded.width}x${decoded.height}; ` +
      `expected ${EXPECTED_CAPTURE_WIDTH}x${EXPECTED_CAPTURE_HEIGHT}.`
    )
  }

  const finalLookCallId = 'electron-domain-smoke-look-final'
  const finalLookResult = await agentTools.call({
    name: 'sciforge_look',
    arguments: {
      sourceRef: captured.artifactRef,
      task: 'Verify the persisted cropped fixture target.',
      intent: 'quality-review'
    },
    context: { ...context, requestId: finalLookCallId, callId: finalLookCallId }
  })
  agentVisualLookOutputSchema.parse(finalLookResult.value)
  observeToolResult(guard, runtimeId, threadId, turnId, finalLookCallId, finalLookResult)

  const pendingBeforeCompletion = guard.turnValidationState(runtimeId, threadId, turnId)
  const terminal = guard.observe(runtimeId, {
    kind: 'turn_lifecycle',
    runtimeId,
    threadId,
    turnId,
    state: 'completed'
  })
  if (pendingBeforeCompletion.nativeVisualObligationsPending || terminal.violation) {
    throw new Error(
      terminal.violation?.detail ?? 'Native visual smoke proof chain remained incomplete.'
    )
  }

  let unavailableRouteFailedVisibly = false
  try {
    await agentTools.call({
      name: 'sciforge_look',
      arguments: {
        sourceRef,
        task: 'electron-domain-smoke:fail-visible',
        intent: 'describe'
      },
      context: {
        runtimeId,
        threadId,
        turnId,
        workspaceId: workspaceDirectory,
        requestId: 'electron-domain-smoke-look-unavailable',
        callId: 'electron-domain-smoke-look-unavailable'
      }
    })
  } catch (error) {
    unavailableRouteFailedVisibly = /HTTP 503/u.test(
      error instanceof Error ? error.message : String(error)
    )
  }
  if (!unavailableRouteFailedVisibly) {
    throw new Error('Unavailable Model Router visual execution did not fail visibly.')
  }

  return {
    toolNames,
    artifactRelativePath: captured.relativePath,
    artifactSha256: captured.sha256,
    captureWidth: captured.width,
    captureHeight: captured.height,
    cropped: captured.proof.cropped,
    datasetLoopCapabilitiesDiscoverable: true,
    nativeImageBindingValidated: true,
    proofChainValidated: true,
    unavailableRouteFailedVisibly
  }
}

async function openWorkspaceVisualSource(
  agentTools: CapabilityAgentToolSurface,
  path: string,
  workspaceRoot: string,
  context: Omit<CapabilityAgentToolRequestContext, 'requestId'>
): Promise<string> {
  const discovered = await agentTools.call({
    name: 'sciforge_discover',
    arguments: { text: 'open workspace preview' },
    context: {
      ...context,
      requestId: 'electron-domain-smoke-discover-preview',
      callId: 'electron-domain-smoke-discover-preview'
    }
  })
  if (discovered.tool !== 'sciforge_discover') {
    throw new Error('Native visual smoke did not receive a discovery result.')
  }
  const operationRef = discovered.value.find(
    (operation) => operation.title === 'Open Workspace Preview'
  )?.operationRef
  if (!operationRef) {
    throw new Error('Native visual smoke could not discover the canonical workspace preview operation.')
  }
  const opened = await agentTools.call({
    name: 'sciforge_invoke',
    arguments: {
      operationRef,
      input: {
        path,
        workspaceRoot,
        mode: 'inspect'
      }
    },
    context: {
      ...context,
      requestId: 'electron-domain-smoke-open-preview',
      callId: 'electron-domain-smoke-open-preview'
    }
  })
  if (opened.tool !== 'sciforge_invoke') {
    throw new Error('Native visual smoke did not receive a workspace preview invocation result.')
  }
  const output = opened.value.output
  const resourceRef = (
    output && typeof output === 'object' && !Array.isArray(output)
      ? (output as Record<string, unknown>).resourceRef
      : undefined
  )
  if (typeof resourceRef !== 'string' || !/^res_[A-Za-z0-9_-]{20,}$/u.test(resourceRef)) {
    throw new Error('Native visual smoke did not receive a workspace preview resource reference.')
  }
  return resourceRef
}

function observeToolResult(
  guard: RuntimeExecutionIntegrityGuard,
  runtimeId: 'codex',
  threadId: string,
  turnId: string,
  callId: string,
  result: Readonly<{ tool: string; value: unknown }>
): void {
  const execution = nativeAgentToolExecutionMetadata(result, callId)
  const event: AgentRuntimeToolEvent = {
    kind: 'tool_event',
    runtimeId,
    threadId,
    turnId,
    itemId: callId,
    callId,
    toolName: result.tool,
    toolKind: 'tool_call',
    effects: execution.effects,
    completionReceipts: execution.completionReceipts,
    status: 'success',
    receipt: createExecutionReceipt({ status: 'success' }),
    phase: 'succeeded',
    factSource: 'executor_result',
    evidenceStrength: 'attested'
  }
  guard.observe(runtimeId, event)
}

function resolveWorkspaceDirectory(rawPath: string): string {
  if (!rawPath.trim() || !isAbsolute(rawPath)) {
    throw new Error('Native visual smoke requires an absolute workspace directory.')
  }
  return resolve(rawPath)
}

function fixturePng(): Buffer {
  const canvas = createCanvas(FIXTURE_WIDTH, FIXTURE_HEIGHT)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, FIXTURE_WIDTH, FIXTURE_HEIGHT)
  context.fillStyle = '#165dff'
  context.fillRect(
    FIXTURE_WIDTH * REGION.x,
    FIXTURE_HEIGHT * REGION.y,
    EXPECTED_CAPTURE_WIDTH,
    EXPECTED_CAPTURE_HEIGHT
  )
  return canvas.toBuffer('image/png')
}
