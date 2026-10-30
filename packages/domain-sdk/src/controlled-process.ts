import { z } from 'zod'

import {
  domainCapabilityResourceHandleSchema
} from './renderer-contributions.js'
import type { DomainCapabilityContract } from './host.js'

export const CONTROLLED_PROCESS_RESOURCE_KIND = 'host.controlled-process' as const
export const CONTROLLED_PROCESS_CREATE_ACTION_ID = 'controlled-process.create' as const
export const CONTROLLED_PROCESS_READ_ACTION_ID = 'controlled-process.read' as const
export const CONTROLLED_PROCESS_WRITE_ACTION_ID = 'controlled-process.write' as const
export const CONTROLLED_PROCESS_RESIZE_ACTION_ID = 'controlled-process.resize' as const
export const CONTROLLED_PROCESS_DISPOSE_ACTION_ID = 'controlled-process.dispose' as const

export const CONTROLLED_PROCESS_LIMITS = Object.freeze({
  maxWriteCharacters: 100_000,
  maxReadCharacters: 1_000_000,
  maxReadWaitMilliseconds: 30_000,
  minColumns: 1,
  maxColumns: 1_000,
  minRows: 1,
  maxRows: 1_000
} as const)

export const controlledProcessCreateInputSchema = z.object({
  profile: z.literal('system-shell'),
  cwd: z.string().min(1).max(4_096).optional(),
  terminal: z.object({
    columns: z.number().int()
      .min(CONTROLLED_PROCESS_LIMITS.minColumns)
      .max(CONTROLLED_PROCESS_LIMITS.maxColumns),
    rows: z.number().int()
      .min(CONTROLLED_PROCESS_LIMITS.minRows)
      .max(CONTROLLED_PROCESS_LIMITS.maxRows)
  }).strict().optional()
}).strict()

export const controlledProcessCreateOutputSchema = z.object({
  resourceKind: z.literal(CONTROLLED_PROCESS_RESOURCE_KIND),
  resource: domainCapabilityResourceHandleSchema,
  cursor: z.string().min(1).max(512)
}).strict()

export const controlledProcessReadInputSchema = z.object({
  cursor: z.string().min(1).max(512),
  maxCharacters: z.number().int()
    .min(1)
    .max(CONTROLLED_PROCESS_LIMITS.maxReadCharacters)
    .optional(),
  waitMilliseconds: z.number().int()
    .min(0)
    .max(CONTROLLED_PROCESS_LIMITS.maxReadWaitMilliseconds)
    .optional()
}).strict()

export const controlledProcessReadOutputSchema = z.object({
  cursor: z.string().min(1).max(512),
  chunks: z.array(z.object({
    stream: z.enum(['stdout', 'stderr']),
    data: z.string().max(CONTROLLED_PROCESS_LIMITS.maxReadCharacters)
  }).strict()).max(10_000),
  truncated: z.boolean(),
  exit: z.object({
    code: z.number().int().nullable(),
    signal: z.string().min(1).max(128).nullable()
  }).strict().optional()
}).strict().superRefine((output, context) => {
  const characters = output.chunks.reduce((total, chunk) => total + chunk.data.length, 0)
  if (characters <= CONTROLLED_PROCESS_LIMITS.maxReadCharacters) return
  context.addIssue({
    code: 'custom',
    path: ['chunks'],
    message: `Read output cannot exceed ${CONTROLLED_PROCESS_LIMITS.maxReadCharacters} characters.`
  })
})

export const controlledProcessWriteInputSchema = z.object({
  data: z.string().min(1).max(CONTROLLED_PROCESS_LIMITS.maxWriteCharacters)
}).strict()

export const controlledProcessWriteOutputSchema = z.object({
  acceptedCharacters: z.number().int()
    .min(0)
    .max(CONTROLLED_PROCESS_LIMITS.maxWriteCharacters)
}).strict()

export const controlledProcessResizeInputSchema = z.object({
  columns: z.number().int()
    .min(CONTROLLED_PROCESS_LIMITS.minColumns)
    .max(CONTROLLED_PROCESS_LIMITS.maxColumns),
  rows: z.number().int()
    .min(CONTROLLED_PROCESS_LIMITS.minRows)
    .max(CONTROLLED_PROCESS_LIMITS.maxRows)
}).strict()

export const controlledProcessDisposeInputSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
}).strict()

export const controlledProcessMutationOutputSchema = z.object({
  ok: z.literal(true)
}).strict()

export type ControlledProcessCreateInput = z.input<typeof controlledProcessCreateInputSchema>
export type ControlledProcessCreateOutput = z.infer<typeof controlledProcessCreateOutputSchema>
export type ControlledProcessReadInput = z.infer<typeof controlledProcessReadInputSchema>
export type ControlledProcessReadOutput = Readonly<{
  cursor: string
  chunks: readonly Readonly<{
    stream: 'stdout' | 'stderr'
    data: string
  }>[]
  truncated: boolean
  exit?: Readonly<{
    code: number | null
    signal: string | null
  }>
}>
export type ControlledProcessWriteInput = z.infer<typeof controlledProcessWriteInputSchema>
export type ControlledProcessWriteOutput = z.infer<typeof controlledProcessWriteOutputSchema>
export type ControlledProcessResizeInput = z.infer<typeof controlledProcessResizeInputSchema>
export type ControlledProcessDisposeInput = z.infer<typeof controlledProcessDisposeInputSchema>
export type ControlledProcessMutationOutput = z.infer<
  typeof controlledProcessMutationOutputSchema
>

export const CONTROLLED_PROCESS_CREATE_CONTRACT: DomainCapabilityContract<
  ControlledProcessCreateInput,
  ControlledProcessCreateOutput
> = Object.freeze({
  actionId: CONTROLLED_PROCESS_CREATE_ACTION_ID,
  effect: 'external-write',
  inputSchema: controlledProcessCreateInputSchema,
  outputSchema: controlledProcessCreateOutputSchema
})

export const CONTROLLED_PROCESS_READ_CONTRACT: DomainCapabilityContract<
  ControlledProcessReadInput,
  ControlledProcessReadOutput
> = Object.freeze({
  actionId: CONTROLLED_PROCESS_READ_ACTION_ID,
  effect: 'read',
  inputSchema: controlledProcessReadInputSchema,
  outputSchema: controlledProcessReadOutputSchema
})

export const CONTROLLED_PROCESS_WRITE_CONTRACT: DomainCapabilityContract<
  ControlledProcessWriteInput,
  ControlledProcessWriteOutput
> = Object.freeze({
  actionId: CONTROLLED_PROCESS_WRITE_ACTION_ID,
  effect: 'external-write',
  inputSchema: controlledProcessWriteInputSchema,
  outputSchema: controlledProcessWriteOutputSchema
})

export const CONTROLLED_PROCESS_RESIZE_CONTRACT: DomainCapabilityContract<
  ControlledProcessResizeInput,
  ControlledProcessMutationOutput
> = Object.freeze({
  actionId: CONTROLLED_PROCESS_RESIZE_ACTION_ID,
  effect: 'compute',
  inputSchema: controlledProcessResizeInputSchema,
  outputSchema: controlledProcessMutationOutputSchema
})

export const CONTROLLED_PROCESS_DISPOSE_CONTRACT: DomainCapabilityContract<
  ControlledProcessDisposeInput,
  ControlledProcessMutationOutput
> = Object.freeze({
  actionId: CONTROLLED_PROCESS_DISPOSE_ACTION_ID,
  effect: 'external-write',
  inputSchema: controlledProcessDisposeInputSchema,
  outputSchema: controlledProcessMutationOutputSchema
})
