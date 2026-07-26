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
import type { CapabilityAgentToolSurface } from './capabilities/agent-tools'
import { nativeAgentToolExecutionMetadata } from './runtime/agent-runtime/agent-tool-surface'
import { RuntimeExecutionIntegrityGuard } from './runtime/agent-runtime/execution-integrity-guard'
import {
  VISUAL_EXECUTION_PLAN_METADATA_KEY,
  VISUAL_EXECUTION_REQUIRED_METADATA_KEY
} from './runtime/agent-runtime/visual-execution-guard'
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
  agentTools: CapabilityAgentToolSurface
): void {
  if (process.env.SCIFORGE_ELECTRON_SMOKE !== '1') return
  globalThis.__SCIFORGE_ELECTRON_DOMAIN_NATIVE_VISUAL_SMOKE__ = async (input) =>
    runElectronDomainNativeVisualSmoke(agentTools, input)
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

  const runtimeId = 'codex'
  const threadId = 'electron-domain-smoke-thread'
  const turnId = 'electron-domain-smoke-turn'
  const context = {
    runtimeId,
    threadId,
    turnId,
    workspaceId: workspaceDirectory
  }
  const guard = new RuntimeExecutionIntegrityGuard()
  guard.rememberTurn(runtimeId, {
    runtimeId,
    threadId,
    text: 'Capture the located fixture target and verify the persisted result.',
    displayText: 'Capture the located fixture target and verify the persisted result.',
    workspace: workspaceDirectory,
    metadata: {
      [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true,
      [VISUAL_EXECUTION_PLAN_METADATA_KEY]: 'capture-region'
    }
  }, threadId, turnId)

  const locateCallId = 'electron-domain-smoke-look-locate'
  const lookedResult = await agentTools.call({
    name: 'sciforge_look',
    arguments: {
      path: fixtureRelativePath,
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
  const unavailableTurnId = 'electron-domain-smoke-unavailable-turn'
  try {
    await agentTools.call({
      name: 'sciforge_look',
      arguments: {
        path: fixtureRelativePath,
        task: 'electron-domain-smoke:fail-visible',
        intent: 'describe'
      },
      context: {
        runtimeId,
        threadId,
        turnId: unavailableTurnId,
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
    nativeImageBindingValidated: true,
    proofChainValidated: true,
    unavailableRouteFailedVisibly
  }
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
