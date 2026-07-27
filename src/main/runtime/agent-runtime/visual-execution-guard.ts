import type {
  AgentRuntimeExecutionIntent,
  AgentRuntimeTurnStartInput
} from '../../../shared/agent-runtime-contract'

type VisualExecutionRequirements = Readonly<{
  capture: boolean
  captureRegion: boolean
  validateReference: boolean
}>

/**
 * Adds model guidance for visual work already declared by the caller's typed
 * execution intent. Natural-language task text and arbitrary metadata are not
 * classification inputs at this enforcement boundary.
 */
export function withVisualExecutionRequirement(
  input: AgentRuntimeTurnStartInput
): AgentRuntimeTurnStartInput {
  const requirements = visualExecutionRequirements(input.executionIntent)
  if (!requirements) return input
  const captureInstruction = requirements.capture
    ? [
        '- Call `sciforge_look` to locate the target, then `sciforge_capture` with its opaque proof and region references.',
        ...(requirements.captureRegion
          ? ['- Persist the located region, not the full snapshot; completion requires a cropped capture receipt bound to that region.']
          : []),
        '- Inspect the persisted artifact with a final `sciforge_look`; a rendered page or file-existence check is not final visual verification.'
      ].join('\n')
    : '- Call `sciforge_look`; prose, file metadata, screenshots from other tools, and shell output do not satisfy inspection.'
  const referenceInstruction = requirements.validateReference
    ? '- The referenced consumer must pass its typed artifact reference validation before completion.'
    : ''
  const instruction = [
    'Runtime-enforced visual completion gate:',
    captureInstruction,
    referenceInstruction,
    '- Only runtime-issued typed completion receipts count. If a required native visual capability is unavailable, report the blocker instead of claiming completion.'
  ].filter(Boolean).join('\n')
  return {
    ...input,
    text: `${instruction}\n\n${input.text}`,
    displayText: input.displayText ?? input.text
  }
}

function visualExecutionRequirements(
  intent: AgentRuntimeExecutionIntent | undefined
): VisualExecutionRequirements | null {
  if (!intent || intent.mode === 'answer') return null
  const requirements = intent.requirements ?? []
  const inspect = requirements.some((requirement) => requirement.receiptKind === 'visual.look')
  const capture = requirements.some((requirement) => requirement.receiptKind === 'visual.capture')
  if (!inspect && !capture) return null
  return {
    capture,
    captureRegion: requirements.some((requirement) => (
      requirement.receiptKind === 'visual.capture' &&
      requirement.requiresRegionRef === true
    )),
    validateReference: requirements.some((requirement) => (
      requirement.receiptKind === 'artifact.reference-validation'
    ))
  }
}
