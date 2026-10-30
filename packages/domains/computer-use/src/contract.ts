import { z } from 'zod'

export const computerUseIsolationSchema = z.literal('host-app-scoped')
export const computerUseBackendSchema = z.literal('browser-cdp')
export const computerUseTargetKindSchema = z.enum(['browser-page', 'electron-webcontents'])

export const computerUseTargetSchema = z.object({
  targetId: z.string().trim().min(1).max(512),
  kind: computerUseTargetKindSchema,
  ownership: z.enum(['attached', 'managed']),
  locator: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  generation: z.string().trim().min(1).max(512),
  metadata: z.record(z.string(), z.unknown()).default({})
}).strict()

export const computerUseExpectationSchema = z.object({
  kind: z.literal('text-present'),
  text: z.string().min(1).max(512),
  stableForMs: z.number().int().min(0).max(10_000).default(0)
}).strict()

const clickStep = z.object({
  kind: z.literal('click'),
  role: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(512)
}).strict()
const typeStep = z.object({ kind: z.literal('type'), text: z.string().max(4096) }).strict()
const pressStep = z.object({
  kind: z.literal('press'),
  keys: z.array(z.string().trim().min(1).max(64)).min(1).max(8)
}).strict()
const scrollStep = z.object({
  kind: z.literal('scroll'),
  deltaX: z.number().finite().min(-10_000).max(10_000).default(0),
  deltaY: z.number().finite().min(-10_000).max(10_000)
}).strict()

export const computerUseSemanticActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('observe'), expect: computerUseExpectationSchema.optional() }).strict(),
  z.object({
    kind: z.literal('click'),
    role: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(512),
    expect: computerUseExpectationSchema.optional()
  }).strict(),
  z.object({
    kind: z.literal('sequence'),
    steps: z.array(z.discriminatedUnion('kind', [clickStep, typeStep, pressStep, scrollStep])).min(1).max(32),
    expect: computerUseExpectationSchema.optional()
  }).strict()
])

export const computerUseEmptyInputSchema = z.object({}).strict()
export const computerUseBindTargetInputSchema = z.object({
  target: computerUseTargetSchema
}).strict()
export const computerUseReleaseSessionInputSchema = z.object({ sessionId: z.string().uuid() }).strict()
export const computerUseRunInputSchema = z.object({
  sessionId: z.string().uuid(),
  semanticAction: computerUseSemanticActionSchema,
  expectedRevision: z.string().trim().min(1).max(512).optional(),
  deadlineMs: z.number().int().min(1).max(600_000).optional(),
  instruction: z.string().trim().min(1).max(1024).optional()
}).strict()

// The MCP boundary deliberately admits instruction-only legacy shape far
// enough to return the stable breaking-change error code. Actual execution is
// still parsed by computerUseRunInputSchema and always requires a Session and
// semanticAction.
export const computerUseToolInputSchema = z.object({
  sessionId: z.string().uuid().optional(),
  semanticAction: computerUseSemanticActionSchema.optional(),
  expectedRevision: z.string().trim().min(1).max(512).optional(),
  deadlineMs: z.number().int().min(1).max(600_000).optional(),
  instruction: z.string().trim().min(1).max(1024).optional()
}).strict()

export type ComputerUseRunInput = z.infer<typeof computerUseRunInputSchema>
