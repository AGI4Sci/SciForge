import { z } from 'zod'

/** Runtime-neutral user input. This is data collection, never an approval grant. */
export const USER_INPUT_PRESENTATION_LOCATION = 'chat.user-input' as const
export const userInputPresentationContractSchema = z.object({ location: z.literal(USER_INPUT_PRESENTATION_LOCATION), contractVersion: z.literal(1) }).strict()
const text = z.string().trim().min(1).max(4_000)
export const userInputQuestionSchema = z.object({
  id: z.string().trim().min(1).max(128),
  header: z.string().max(120).default(''),
  question: text.max(1_024),
  options: z.array(z.object({
    id: z.string().trim().min(1).max(128).optional(),
    label: text.max(256).refine((value) => value !== 'Other', 'Other is reserved for free text.'),
    description: z.string().max(512).default(''),
    recommended: z.boolean().optional()
  }).strict()).max(8).default([])
}).strict().superRefine((question, context) => {
  const labels = question.options.map((option) => option.label)
  const ids = question.options.map((option) => option.id ?? option.label)
  if (new Set(labels).size !== labels.length || new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Option IDs and labels must be unique.' })
  }
})
export const userInputRequestSchema = z.object({
  questions: z.array(userInputQuestionSchema).min(1).max(3)
}).strict().superRefine(({ questions }, context) => {
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    context.addIssue({ code: 'custom', message: 'Question IDs must be unique.' })
  }
})
export const userInputAnswerSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().max(4_000),
  value: z.string().trim().min(1).max(16_000)
}).strict()
export const userInputResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('submitted'), answers: z.array(userInputAnswerSchema).min(1).max(3) }).strict(),
  z.object({ status: z.literal('cancelled'), answers: z.array(userInputAnswerSchema).length(0) }).strict()
])
export type DomainUserInputRequest = z.infer<typeof userInputRequestSchema>
export type DomainUserInputAnswer = z.infer<typeof userInputAnswerSchema>
export type DomainUserInputResult = z.infer<typeof userInputResultSchema>
export type DomainMainUserInputHost = Readonly<{
  /** Host derives the runtime, thread and turn from the active tool invocation. */
  request(input: DomainUserInputRequest): Promise<DomainUserInputResult>
}>
export function validateUserInputAnswers(request: DomainUserInputRequest, raw: unknown): DomainUserInputAnswer[] {
  const answers = z.array(userInputAnswerSchema).parse(raw)
  if (answers.length !== request.questions.length || new Set(answers.map((answer) => answer.id)).size !== answers.length) {
    throw new Error('Answer every question exactly once.')
  }
  return request.questions.map((question) => {
    const answer = answers.find((candidate) => candidate.id === question.id)
    if (!answer || (question.options.length > 0 && answer.label !== 'Other' &&
      !question.options.some((option) => option.label === answer.label))) {
      throw new Error('Answer does not belong to this question.')
    }
    return answer
  })
}

/** A single installed presenter owns both the transcript card and its dialog. */
export type DomainUserInputPresentation<View = unknown> = Readonly<{
  render(context: Readonly<{
    requestId: string
    questions: DomainUserInputRequest['questions']
    answers?: DomainUserInputAnswer[]
    status: 'pending' | 'submitted' | 'cancelled' | 'error'
    errorMessage?: string
    autoOpen: boolean
    active?: boolean
    onSubmit(answers: DomainUserInputAnswer[]): Promise<void>
    onCancel(): Promise<void>
  }>): View
}>
