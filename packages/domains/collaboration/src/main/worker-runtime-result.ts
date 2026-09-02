import { domainMainAgentExecutionOutputSchemaSchema } from '@sciforge/domain-sdk/agent-execution'
import { z } from 'zod'

// A worst-case JSON-escaped summary at this limit still leaves more than
// 15 KiB in the default 64 KiB text-task task.result.submit body.
export const WORKER_RESULT_SUMMARY_MAX_CODE_POINTS = 8_000

// JSON Schema maxLength counts Unicode code points, while Zod's built-in max
// check counts UTF-16 code units. Keep separate but equivalent validators so a
// provider-valid emoji-heavy result remains valid at the local boundary.
function semanticBoundedString(maxCodePoints: number): z.ZodString {
  return z.string()
    .refine(
      (value) => Array.from(value).length <= maxCodePoints,
      `Value must contain at most ${maxCodePoints} Unicode code points.`
    )
    .trim()
    .min(1)
    .regex(/\S/u)
}

function providerBoundedString(maxCodePoints: number): z.ZodString {
  return z.string().min(1).max(maxCodePoints).regex(/\S/u)
}

const safeQuestionSchema = semanticBoundedString(4_000)

const completedWorkerRuntimeResultSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: z.literal('completed'),
  summary: semanticBoundedString(WORKER_RESULT_SUMMARY_MAX_CODE_POINTS)
}).strict()

const needsHumanWorkerRuntimeResultSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: z.literal('needs_human'),
  question: safeQuestionSchema,
  requiredAssurance: z.enum(['verified', 'strong'])
}).strict()

export const workerRuntimeResultSchema = z.discriminatedUnion('outcome', [
  completedWorkerRuntimeResultSchema,
  needsHumanWorkerRuntimeResultSchema
])

export type WorkerRuntimeResult = z.infer<typeof workerRuntimeResultSchema>

/**
 * Provider-facing wire schema for the final Worker turn.
 *
 * Structured-output providers require one root object and all fields in each
 * object branch to be required. The root therefore contains one required
 * `result` property whose value is the semantic union. This keeps the provider
 * wire contract isomorphic to `WorkerRuntimeResult` without putting a union at
 * the schema root or introducing nullable inactive fields that the provider
 * could legally combine in a shape rejected by the parser.
 */
const workerRuntimeResultStructuredSchema = z.object({
  // A regular union emits nested `anyOf`, which is supported by structured
  // output providers while retaining a root object. The discriminated union
  // above remains the canonical semantic validator.
  result: z.union([
    completedWorkerRuntimeResultSchema,
    needsHumanWorkerRuntimeResultSchema
  ])
}).strict()

const workerRuntimeResultProviderSchema = z.object({
  result: z.union([
    z.object({
      schemaVersion: z.literal(1),
      outcome: z.literal('completed'),
      summary: providerBoundedString(WORKER_RESULT_SUMMARY_MAX_CODE_POINTS)
    }).strict(),
    z.object({
      schemaVersion: z.literal(1),
      outcome: z.literal('needs_human'),
      question: providerBoundedString(4_000),
      requiredAssurance: z.enum(['verified', 'strong'])
    }).strict()
  ])
}).strict()

export const workerRuntimeResultOutputSchema = Object.freeze(
  domainMainAgentExecutionOutputSchemaSchema.parse(
    z.toJSONSchema(workerRuntimeResultProviderSchema, {
      target: 'draft-07',
      unrepresentable: 'throw'
    })
  )
)

const WORKER_RESULT_FORMAT_INSTRUCTION = [
  'The Worker result envelope is closed and always contains exactly one top-level key: result.',
  'The result value must match exactly one closed shape: completed or needs_human.',
  'For completed, result contains exactly schemaVersion, outcome, and summary; summary must be one JSON string containing non-whitespace content, and every task-specific table, matrix, recommendation, or design specification belongs inside that string.',
  'For needs_human, result contains exactly schemaVersion, outcome, question, and requiredAssurance; question must be one non-whitespace bounded string and requiredAssurance must be verified or strong.',
  'Never omit result, emit an object-valued summary, add another root key, add an inactive branch field, or use a Markdown fence.'
].join(' ')

const WORKER_RESULT_RESPONSE_INSTRUCTIONS = Object.freeze([
  'Return exactly one JSON object and no Markdown fence.',
  WORKER_RESULT_FORMAT_INSTRUCTION,
  'If the task is complete: {"result":{"schemaVersion":1,"outcome":"completed","summary":"bounded result summary"}}',
  'If the authenticated Worker User input is required: {"result":{"schemaVersion":1,"outcome":"needs_human","question":"one bounded question","requiredAssurance":"verified"}}'
])

export function parseWorkerRuntimeResult(text: string): WorkerRuntimeResult {
  try {
    return workerRuntimeResultStructuredSchema.parse(JSON.parse(text)).result
  } catch (error) {
    throw new Error('Agent Runtime did not return the required strict Worker JSON result.', {
      cause: error
    })
  }
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
  const taskText = [task.title, task.objective, ...task.completionCriteria].join('\n')
  const isDesignAnalysisOnly = task.fileIntent === null &&
    /design[- ]analysis(?:-only)?|只做设计分析|仅做设计分析/iu.test(taskText) &&
    /不执行|do not (?:run|execute)|unexecuted/iu.test(taskText)
  const textReportInstructions = isDesignAnalysisOnly
    ? [
        '',
        'Design-analysis-only collaboration task report:',
        'You may propose an experiment or validation design, but do not run or claim an experiment, simulation, wet-lab action, or other external side effect; label future work as proposed/unexecuted.',
        'Put these headings in the JSON "summary" string, using the task language:',
        '- Expert / Role and Sub-question / 专家（角色）与子问题: identify the assigned role and exact scope.',
        '- Conclusion / 结论: the answer to this Worker sub-question, with [expert:<role>] attribution.',
        '- Evidence or basis / 依据（证据）: every material claim gets [expert:<role>] or [source:<label>]; distinguish facts, assumptions, and proposals.',
        '- Recommendation or next action / 建议（下一步）: one or more bounded actions for the Coordinator.',
        '- Uncertainty / 不确定性 (optional): assumptions or unresolved disagreement for the Coordinator to reconcile.',
        'Keep the report concise and bounded; do not claim a source, measurement, or execution that you did not actually observe.'
      ]
    : []
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
    ...textReportInstructions,
    ...fileInstructions,
    '',
    ...WORKER_RESULT_RESPONSE_INSTRUCTIONS
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
    ...WORKER_RESULT_RESPONSE_INSTRUCTIONS
  ].join('\n')
}

/**
 * Follow-up prompt for an explicit human intervention while a Worker Task is
 * still running.  It deliberately keeps the exact Session and result
 * protocol, so guidance cannot accidentally become an unrelated chat turn or
 * mutate a fenced Cloud execution.
 */
export function workerGuidancePrompt(guidance: string): string {
  const bounded = guidance.trim().slice(0, 32_000)
  if (!bounded) throw new Error('Worker guidance is empty.')
  return [
    'The authenticated human provided the following guidance for the current Project Task:',
    '',
    bounded,
    '',
    'Continue the same Project Task in this exact Agent Session and apply the guidance.',
    ...WORKER_RESULT_RESPONSE_INSTRUCTIONS
  ].join('\n')
}

/**
 * Follow-up prompt used when a Worker turn completes but its final message
 * cannot be parsed as the protocol result.  The task execution remains open
 * while this bounded repair turn runs, so a transient formatting mistake does
 * not fence the Cloud execution before the Worker has one chance to correct
 * its response in the same Session.
 */
export function workerResultRepairPrompt(): string {
  return [
    'Your previous Worker response did not match the required result protocol.',
    'Continue the same Project Task; do not repeat the full explanation.',
    ...WORKER_RESULT_RESPONSE_INSTRUCTIONS
  ].join('\n')
}
