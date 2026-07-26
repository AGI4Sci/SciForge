import type { AgentRuntimeTurnStartInput } from '../../../shared/agent-runtime-contract'

export const VISUAL_EXECUTION_REQUIRED_METADATA_KEY = 'sciforgeVisualExecutionRequired'
export const VISUAL_EXECUTION_PLAN_METADATA_KEY = 'sciforgeVisualExecutionPlan'

export type VisualExecutionPlan =
  | 'inspect'
  | 'capture'
  | 'capture-region'
  | 'capture-reference'

const VISUAL_INSPECTION_PATTERNS = [
  /\b(?:visually\s+(?:inspect|review|verify|check)|visual\s+(?:qa|review|verification|inspection)|use\s+(?:the\s+)?vision\s+(?:tool|capability)|look\s+at\s+(?:the\s+)?(?:image|screenshot|render|layout)|inspect\s+(?:the\s+)?(?:image|screenshot|rendered|layout))\b/iu,
  /\b(?:optimi[sz]e|improve|fix|evaluate|review)\b.{0,40}\b(?:layout|typesetting|rendered\s+(?:image|page)|visual\s+appearance)\b/iu,
  /(?:用|使用).{0,10}(?:视觉|图像).{0,12}(?:能力|工具|检查|复核|验证|看)/u,
  /(?:视觉|图像)(?:检查|复核|验收|验证|审查|能力看)/u,
  /(?:看一下|查看|检查|复核).{0,16}(?:排版后的|渲染后的)?(?:表格|图片|图像|截图|页面|文档|排版|布局)/iu,
  /(?:优化|改进|修复|评估).{0,16}(?:排版|布局|视觉效果|渲染结果)/u
]

const VISUAL_CAPTURE_PATTERNS = [
  /(?:截图|保存为图片)/u,
  /\b(?:capture|screenshot|save\s+(?:it\s+)?as\s+(?:an?\s+)?image)\b/iu
]

const VISUAL_REGION_CAPTURE_PATTERNS = [
  /(?:截取|摘录|裁剪)/u,
  /\b(?:crop|extract.{0,24}(?:figure|diagram|image|region))\b/iu
]

export function visualExecutionPlanForText(text: string): VisualExecutionPlan | null {
  const value = text.trim()
  if (!value) return null
  if (VISUAL_REGION_CAPTURE_PATTERNS.some((pattern) => pattern.test(value))) {
    return 'capture-region'
  }
  if (VISUAL_CAPTURE_PATTERNS.some((pattern) => pattern.test(value))) {
    return 'capture'
  }
  return VISUAL_INSPECTION_PATTERNS.some((pattern) => pattern.test(value))
    ? 'inspect'
    : null
}

export function requiresVerifiedVisualInspection(text: string): boolean {
  return visualExecutionPlanForText(text) !== null
}

export function withVisualExecutionRequirement(
  input: AgentRuntimeTurnStartInput,
  required: boolean
): AgentRuntimeTurnStartInput {
  const explicitPlan = visualExecutionPlanFromMetadata(input.metadata)
  if (!required && !explicitPlan) return input
  const plan = explicitPlan ?? visualExecutionPlanForText(input.displayText ?? input.text) ?? 'inspect'
  const captureInstruction = plan === 'inspect'
    ? '- Call `sciforge_look`; prose, file metadata, screenshots from other tools, and shell output do not satisfy inspection.'
    : [
        '- Call `sciforge_look` to locate the target, then `sciforge_capture` with its opaque proof and region references.',
        ...(plan === 'capture-region'
          ? ['- Persist the located region, not the full snapshot; completion requires a cropped capture receipt bound to that region.']
          : []),
        '- Inspect the persisted artifact with a final `sciforge_look`; a rendered page or file-existence check is not final visual verification.'
      ].join('\n')
  const referenceInstruction = plan === 'capture-reference'
    ? '- The referenced consumer must pass its typed artifact reference validation before completion.'
    : ''
  const instruction = [
    'Runtime-enforced visual completion gate:',
    `- Required visual plan: ${plan}.`,
    captureInstruction,
    referenceInstruction,
    '- Only runtime-issued typed completion receipts count. If a required native visual capability is unavailable, report the blocker instead of claiming completion.'
  ].filter(Boolean).join('\n')
  return {
    ...input,
    text: `${instruction}\n\n${input.text}`,
    displayText: input.displayText ?? input.text,
    metadata: {
      ...(input.metadata ?? {}),
      [VISUAL_EXECUTION_REQUIRED_METADATA_KEY]: true,
      [VISUAL_EXECUTION_PLAN_METADATA_KEY]: plan
    }
  }
}

function visualExecutionPlanFromMetadata(
  metadata: AgentRuntimeTurnStartInput['metadata']
): VisualExecutionPlan | null {
  const value = metadata?.[VISUAL_EXECUTION_PLAN_METADATA_KEY]
  return value === 'inspect' ||
    value === 'capture' ||
    value === 'capture-region' ||
    value === 'capture-reference'
    ? value
    : null
}
