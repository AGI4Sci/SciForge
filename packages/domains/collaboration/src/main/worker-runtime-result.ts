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

export function parseWorkerRuntimeResult(text: string): WorkerRuntimeResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error('Agent Runtime did not return the required strict Worker JSON result.', {
      cause: error
    })
  }
  return workerRuntimeResultSchema.parse(value)
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
    'If Project Owner input is required: {"schemaVersion":1,"outcome":"needs_human","question":"one bounded question","requiredAssurance":"verified"}'
  ].join('\n')
}

export function workerHumanAnswerPrompt(answer: string): string {
  const bounded = answer.trim().slice(0, 32_000)
  if (!bounded) throw new Error('Project Owner answer is empty.')
  return [
    'The authenticated Project Owner answered the pending HumanNeeded request:',
    '',
    bounded,
    '',
    'Continue the same Project Task in the same Workspace and Agent Session.',
    'Return exactly one strict JSON object using the previously specified completed or needs_human shape.'
  ].join('\n')
}
