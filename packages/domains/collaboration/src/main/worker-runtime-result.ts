import { z } from 'zod'

const safeSummarySchema = z.string().trim().min(1).max(32_000)

export const workerRuntimeResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    schemaVersion: z.literal(1),
    outcome: z.literal('completed'),
    summary: safeSummarySchema
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    outcome: z.literal('needs_human'),
    question: z.string().trim().min(1).max(4_000),
    requiredAssurance: z.enum(['verified', 'strong']).default('verified')
  }).strict()
])

export type WorkerRuntimeResult = z.infer<typeof workerRuntimeResultSchema>

function balancedJsonObjects(text: string): string[] {
  const candidates: string[] = []
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') {
        inString = true
        continue
      }
      if (character === '{') depth += 1
      else if (character === '}' && --depth === 0) {
        candidates.push(text.slice(start, index + 1))
        break
      }
    }
  }
  return candidates
}

export function parseWorkerRuntimeResult(text: string): WorkerRuntimeResult {
  const source = text.trim()
  if (source.includes('```')) {
    throw new Error('Agent Runtime did not return the required strict Worker JSON result.')
  }
  const parseCandidate = (candidate: string): WorkerRuntimeResult | undefined => {
    try {
      return workerRuntimeResultSchema.parse(JSON.parse(candidate))
    } catch {
      return undefined
    }
  }
  try {
    const exact = parseCandidate(source)
    if (exact) return exact
  } catch (error) {
    throw new Error('Agent Runtime did not return the required strict Worker JSON result.', {
      cause: error
    })
  }
  const validCandidates = balancedJsonObjects(source)
    .map(parseCandidate)
    .filter((candidate): candidate is WorkerRuntimeResult => candidate !== undefined)
  if (validCandidates.length === 1) return validCandidates[0]
  if (validCandidates.length > 1) {
    throw new Error('Agent Runtime returned multiple Worker JSON results.')
  }
  throw new Error('Agent Runtime did not return the required strict Worker JSON result.')
}

export type WorkerPromptTask = Readonly<{
  title: string
  objective: string
  completionCriteria: readonly string[]
  fileIntent: null | Readonly<{
    inputs: readonly Readonly<{ destinationName: string }>[]
    output: Readonly<{
      fileName: string
      mediaType: string
      maxBytes: number
    }>
  }>
}>

export function workerTaskPrompt(task: WorkerPromptTask): string {
  const fileInstructions = task.fileIntent
    ? [
        '',
        'Workspace file contract:',
        `- Read only these downloaded inputs: ${task.fileIntent.inputs.map(({ destinationName }) => destinationName).join(', ') || '(none)'}.`,
        `- Create exactly one new output file at the Workspace-relative path ${task.fileIntent.output.fileName}.`,
        `- The output media type is ${task.fileIntent.output.mediaType} and must not exceed ${task.fileIntent.output.maxBytes} bytes.`,
        '- Do not rename the output, choose another directory, upload it, or access Provider credentials. SciForge performs the exact transfer after this turn.'
      ]
    : []
  return [
    `Project Task: ${task.title}`,
    '',
    task.objective,
    '',
    'Completion criteria:',
    ...task.completionCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    ...fileInstructions,
    '',
    'Return exactly one JSON object and no Markdown fence.',
    'If the task is complete: {"schemaVersion":1,"outcome":"completed","summary":"bounded result summary"}',
    'If the authenticated Worker User input is required: {"schemaVersion":1,"outcome":"needs_human","question":"one bounded question","requiredAssurance":"verified"}'
  ].join('\n')
}

export function workerHumanAnswerPrompt(answer: string): string {
  const bounded = answer.trim().slice(0, 32_000)
  if (!bounded) throw new Error('Worker User answer is empty.')
  return [
    'The authenticated Worker User answered the pending HumanNeeded request:',
    '',
    bounded,
    '',
    'Continue the same Project Task in the same Workspace and Agent Session.',
    'Return exactly one strict JSON object using the previously specified completed or needs_human shape.'
  ].join('\n')
}
