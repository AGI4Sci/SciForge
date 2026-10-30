import { domainMainAgentExecutionOutputSchemaSchema } from '@sciforge/domain-sdk/agent-execution'
import { z } from 'zod'

// A worst-case JSON-escaped summary at this limit still leaves more than
// 15 KiB in the default 64 KiB text-task task.result.submit body.
export const WORKER_RESULT_SUMMARY_MAX_CODE_POINTS = 8_000

// A HumanNeeded question must carry a real, answerable request. Placeholder
// responses such as "请" or "？？" created meaningless Cloud human requests and
// stalled the execution. There is deliberately no uniform length floor:
// short questions like "用哪个物种？" are valid.
const WORKER_HUMAN_QUESTION_PLACEHOLDERS = Object.freeze([
  '请问',
  '请',
  '？',
  '?',
  '问题',
  'question',
  'TBD',
  'N/A'
] as const)

const WORKER_HUMAN_QUESTION_PLACEHOLDER_SET = new Set(
  WORKER_HUMAN_QUESTION_PLACEHOLDERS.map((value) => value.normalize('NFKC').toLowerCase())
)

function isWorkerHumanQuestionPlaceholder(value: string): boolean {
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  return WORKER_HUMAN_QUESTION_PLACEHOLDER_SET.has(normalized) ||
    WORKER_HUMAN_QUESTION_PLACEHOLDER_SET.has(
      normalized.replace(/[?!.。！？\s]+$/u, '')
    )
}

function placeholderCharacterClass(character: string): string {
  const variants = new Set([character, character.toLowerCase(), character.toUpperCase()])
  const codePoint = character.charCodeAt(0)
  if (codePoint >= 0x21 && codePoint <= 0x7e) {
    variants.add(String.fromCodePoint(codePoint + 0xfee0))
  }
  for (const letter of [character.toLowerCase(), character.toUpperCase()]) {
    const letterCodePoint = letter.charCodeAt(0)
    if (letterCodePoint >= 0x61 && letterCodePoint <= 0x7a) {
      variants.add(String.fromCodePoint(letterCodePoint + 0xfee0))
    }
  }
  return `[${[...variants].join('')}]`
}

const WORKER_HUMAN_QUESTION_PROVIDER_PLACEHOLDER_PATTERN =
  WORKER_HUMAN_QUESTION_PLACEHOLDERS
    .map((placeholder) => [...placeholder].map(placeholderCharacterClass).join(''))
    .join('|')

// Punctuation, symbols, and whitespace that cannot by themselves form a usable
// question. This covers ASCII, general, CJK, and full-width punctuation without
// Unicode property escapes, which JSON Schema patterns cannot portably use.
const WORKER_HUMAN_QUESTION_PUNCTUATION_ONLY_PATTERN =
  '[\\s!-/:-@\\[-`{-~\\u2000-\\u206F\\u3000-\\u3003\\u3008-\\u3011\\u3014-\\u301F\\u3030\\u303D\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]'

const workerHumanQuestionProviderPattern = new RegExp(
  `^(?!\\s*(?:${WORKER_HUMAN_QUESTION_PROVIDER_PLACEHOLDER_PATTERN})[?!.。！？]*\\s*$)` +
  `(?!${WORKER_HUMAN_QUESTION_PUNCTUATION_ONLY_PATTERN}*$)[\\s\\S]*$`
)

// JSON Schema maxLength is enforced in UTF-16 code units by current validators,
// while the canonical parser counts Unicode code points. Provider schemas
// therefore use a deliberately loose structural bound of twice the code-point
// limit (the largest possible UTF-16 length for that many code points) and the
// parser remains the single authority for the exact limit. A provider schema
// must never reject a value the canonical parser accepts.
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
  return z.string().min(1).max(maxCodePoints * 2).regex(/\S/u)
}

// The provider-facing schema mirrors the canonical question boundary without a
// length floor and with only the loose UTF-16 structural bound above. The
// parser owns the exact 4,000-code-point limit.
function providerQuestionString(maxCodePoints: number): z.ZodString {
  return z.string()
    .min(1)
    .max(maxCodePoints * 2)
    .regex(workerHumanQuestionProviderPattern)
}

const safeQuestionSchema = semanticBoundedString(4_000)
  .refine(
    (value) => !isWorkerHumanQuestionPlaceholder(value),
    'Question must not be a placeholder such as "请", "question", "TBD", or "N/A".'
  )
  .refine(
    (value) => /[\p{L}\p{N}]/u.test(value),
    'Question must contain at least one letter, number, or CJK character.'
  )

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
      question: providerQuestionString(4_000),
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

export function parseWorkerRuntimeResult(text: string): WorkerRuntimeResult {
  try {
    return workerRuntimeResultStructuredSchema.parse(JSON.parse(text)).result
  } catch (error) {
    throw new Error('Agent Runtime did not return the required strict Worker JSON result.', {
      cause: error
    })
  }
}
