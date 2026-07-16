import type {
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeTurnStartInput
} from '../../../shared/agent-runtime-contract'

export const VISUAL_EXECUTION_REQUIRED_METADATA_KEY = 'sciforgeVisualExecutionRequired'
const MAX_REMEMBERED_VISUAL_VIOLATIONS = 2_048

type VisualExecutionState = {
  required: boolean
  satisfied: boolean
  evidenceTool?: string
  visualProductionStarted?: boolean
}

export type VisualExecutionObservation = {
  event: AgentRuntimeEvent
  violation?: {
    code: 'runtime_visual_execution_missing'
    message: string
    detail: string
  }
}

export class RuntimeVisualExecutionGuard {
  private readonly states = new Map<string, VisualExecutionState>()
  private readonly violated = new Set<string>()

  rememberTurn(runtimeId: AgentRuntimeId, input: AgentRuntimeTurnStartInput, threadId: string, turnId: string): void {
    const key = visualExecutionKey(runtimeId, threadId, turnId)
    if (!key) return
    const required = input.metadata?.[VISUAL_EXECUTION_REQUIRED_METADATA_KEY] === true
    if (!required) return
    this.states.set(key, { required: true, satisfied: false })
  }

  rejectedTurnIds(runtimeId: AgentRuntimeId, threadId: string): string[] {
    const prefix = `${runtimeId}:${threadId.trim()}:`
    if (!threadId.trim()) return []
    return [...this.violated]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter(Boolean)
  }

  observe(runtimeId: AgentRuntimeId, event: AgentRuntimeEvent): VisualExecutionObservation {
    const turnId = event.turnId?.trim() ?? ''
    const key = visualExecutionKey(runtimeId, event.threadId, turnId)
    if (!key) return { event }
    let state = this.states.get(key)
    if (!state && !this.violated.has(key) && isGuardedVisualUserMessage(event)) {
      state = { required: true, satisfied: false }
      this.states.set(key, state)
    }
    if (!state?.required) {
      if (this.violated.has(key) && event.kind === 'turn_lifecycle' && event.state === 'completed') {
        return { event: failedVisualCompletion(event) }
      }
      return { event }
    }

    const observedTool = normalizedToolName(visualToolName(event))
    if (isVisualProductionEvent(observedTool, event)) {
      state.visualProductionStarted = true
      state.satisfied = false
      this.states.set(key, state)
      return { event }
    }

    if (isVerifiedVisualExecutionEvent(event)) {
      if (state.visualProductionStarted && !isVisualArtifactReviewTool(observedTool)) {
        return { event }
      }
      state.satisfied = true
      state.evidenceTool = visualToolName(event)
      this.states.set(key, state)
      return { event }
    }

    if (event.kind !== 'turn_lifecycle') {
      return { event }
    }
    if (event.state === 'failed' || event.state === 'aborted') {
      this.states.delete(key)
      return { event }
    }
    if (event.state !== 'completed') return { event }
    this.states.delete(key)
    if (state.satisfied) return { event }

    this.rememberViolation(key)
    const failed = failedVisualCompletion(event)
    return {
      event: failed,
      violation: {
        code: 'runtime_visual_execution_missing',
        message: 'Visual completion rejected because no verified visual inspection executed.',
        detail: [
          'This turn required visual inspection, but no successful Model Router-attested gui_visual_capture, gui_workspace_image_inspect, or visual_artifact_review event was observed.',
          'Rendering, compiling, checking file size, or claiming that an image tool returned empty does not satisfy the visual execution gate.'
        ].join(' ')
      }
    }
  }

  private rememberViolation(key: string): void {
    this.violated.add(key)
    while (this.violated.size > MAX_REMEMBERED_VISUAL_VIOLATIONS) {
      const oldest = this.violated.values().next().value
      if (oldest === undefined) return
      this.violated.delete(oldest)
    }
  }
}

export function requiresVerifiedVisualInspection(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  return [
    /\b(?:visually\s+(?:inspect|review|verify|check)|visual\s+(?:qa|review|verification|inspection)|use\s+(?:the\s+)?vision\s+(?:tool|capability)|look\s+at\s+(?:the\s+)?(?:image|screenshot|render|layout)|inspect\s+(?:the\s+)?(?:image|screenshot|rendered|layout))\b/iu,
    /\b(?:optimi[sz]e|improve|fix|evaluate|review)\b.{0,40}\b(?:layout|typesetting|rendered\s+(?:image|page)|visual\s+appearance)\b/iu,
    /(?:用|使用).{0,10}(?:视觉|图像).{0,12}(?:能力|工具|检查|复核|验证|看)/u,
    /(?:视觉|图像)(?:检查|复核|验收|验证|审查|能力看)/u,
    /(?:看一下|查看|检查|复核).{0,16}(?:排版后的|渲染后的)?(?:表格|图片|图像|截图|页面|PDF|排版|布局)/iu,
    /(?:优化|改进|修复|评估).{0,16}(?:排版|布局|视觉效果|渲染结果)/u
  ].some((pattern) => pattern.test(value))
}

export function withVisualExecutionRequirement(
  input: AgentRuntimeTurnStartInput,
  required: boolean
): AgentRuntimeTurnStartInput {
  if (!required) return input
  const instruction = [
    'Runtime-enforced visual completion gate:',
    '- This turn requires real visual inspection after the final render or UI state is available.',
    '- For a visible GUI surface, call `gui_visible_context`, then pass its fresh snapshotToken and visual task to `gui_visual_capture`. For local workspace images, call `gui_workspace_image_inspect` with one task and an artifacts array.',
    '- If this turn creates or revises a visual, completion requires a successful `visual_artifact_review`; screenshots and file inspection do not replace artifact review.',
    '- Unattested capture output, successful compilation, file existence, dimensions, or self-reported inspection does not satisfy the gate.',
    '- Do not claim visual verification unless the tool returned a successful semantic inspection. If it is unavailable, report the blocker instead of claiming completion.'
  ].join('\n')
  return {
    ...input,
    text: `${instruction}\n\n${input.text}`,
    displayText: input.displayText ?? input.text,
    metadata: {
      ...(input.metadata ?? {}),
      [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true
    }
  }
}

export function isVerifiedVisualInspectionItem(item: AgentRuntimeItem): boolean {
  return isVerifiedVisualExecutionEvent({
    kind: 'item_snapshot',
    threadId: 'thread-detail',
    turnId: item.turnId,
    item
  })
}

export function isVerifiedVisualExecutionEvent(event: AgentRuntimeEvent): boolean {
  const tool = visualToolEvent(event)
  if (!tool || tool.status !== 'success') return false
  const name = normalizedToolName(tool.name)
  if (isVisualArtifactReviewTool(name)) return hasSuccessfulVisualArtifactReview(tool)
  const isSemanticInspection = name === 'gui_visual_capture' || name.endsWith('_gui_visual_capture') ||
    name === 'gui_workspace_image_inspect' || name.endsWith('_gui_workspace_image_inspect')
  if (!isSemanticInspection) return false
  return hasVisualInspectionAttestation(tool)
}

function isVisualProductionEvent(name: string, event: AgentRuntimeEvent): boolean {
  const tool = visualToolEvent(event)
  if (!tool || tool.status !== 'success') return false
  if (name === 'visual_generate' || name.endsWith('_visual_generate')) {
    const serialized = `${tool.detail ?? ''}\n${safeJson(tool.meta)}`
    return /["']?routeLocked["']?\s*[:=]\s*true/iu.test(serialized)
  }
  return [
    'image_generation_render',
    'image_generation_edit_from_visual_review_packet',
    'scientific_plotting_render',
    'scientific_plotting_composite'
  ].some((tool) => name === tool || name.endsWith(`_${tool}`))
}

function isVisualArtifactReviewTool(name: string): boolean {
  return name === 'visual_artifact_review' || name.endsWith('_visual_artifact_review')
}

function hasSuccessfulVisualArtifactReview(tool: {
  detail?: string
  meta?: Record<string, unknown>
}): boolean {
  const serialized = `${tool.detail ?? ''}\n${safeJson(tool.meta)}`
  return /["']?ok["']?\s*[:=]\s*true/iu.test(serialized) &&
    /["']?status["']?\s*[:=]\s*["']?(?:publication_ready|draft_ready)/iu.test(serialized) &&
    /["']?pass["']?\s*[:=]\s*true/iu.test(serialized)
}

function isGuardedVisualUserMessage(event: AgentRuntimeEvent): boolean {
  return event.kind === 'user_message' && event.text.includes('Runtime-enforced visual completion gate:')
}

function visualToolName(event: AgentRuntimeEvent): string {
  return visualToolEvent(event)?.name ?? ''
}

function visualToolEvent(event: AgentRuntimeEvent): {
  name: string
  status: string
  detail?: string
  meta?: Record<string, unknown>
} | null {
  if (event.kind === 'tool_event') {
    const meta = recordValue(event.meta)
    return {
      name: stringValue(meta.toolName) || stringValue(meta.name) || event.summary?.trim() || '',
      status: event.status,
      detail: event.detail,
      meta
    }
  }
  if (event.kind !== 'item_snapshot' || event.item.kind !== 'tool') return null
  const meta = recordValue(event.item.meta)
  return {
    name: stringValue(meta.toolName) || stringValue(meta.name) || event.item.summary?.trim() || '',
    status: event.item.status === 'completed' ? 'success' : event.item.status ?? '',
    detail: event.item.detail,
    meta
  }
}

function hasVisualInspectionAttestation(tool: {
  detail?: string
  meta?: Record<string, unknown>
}): boolean {
  const serialized = `${tool.detail ?? ''}\n${safeJson(tool.meta)}`
  return /(?:attestation["']?\s*[:=]\s*["']?|Attestation:\s*)sha256:[a-f0-9]{64}/iu.test(serialized) &&
    /["']?provider["']?\s*[:=]\s*["']?model-router\b|Semantic visual inspection completed/iu.test(serialized)
}

function normalizedToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
}

function failedVisualCompletion(
  event: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>
): AgentRuntimeEvent {
  return {
    ...event,
    state: 'failed',
    message: 'Visual completion rejected: verified visual inspection did not execute.'
  }
}

function visualExecutionKey(runtimeId: AgentRuntimeId, threadId: string, turnId: string): string {
  const thread = threadId.trim()
  const turn = turnId.trim()
  return thread && turn ? `${runtimeId}:${thread}:${turn}` : ''
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}
