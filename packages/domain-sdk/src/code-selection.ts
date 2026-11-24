import { z } from 'zod'
import { domainRendererSelectionSnapshotSchema } from './renderer-contributions.js'

/** Portable evidence, never authority to read a file or execute a tool. */
export const codeAnchorSchema = z.object({
  filePath: z.string().min(1).max(2048).refine((path) => path === path.trim()
    && !/^[\\/]|^[A-Za-z]:|^~[\\/]|^file:/iu.test(path) && !/[\\:]/u.test(path)
    && ![...path].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !path.split('/').some(part => !part || part === '.' || part === '..'), 'Code path must be workspace-relative.'),
  side: z.enum(['old', 'new']), line: z.number().int().positive(), endLine: z.number().int().positive().optional(),
  hunkHeader: z.string().max(2048), code: z.string().max(40000), baseRevision: z.string().trim().min(1).max(256),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/)
}).strict().refine(anchor => anchor.endLine === undefined || anchor.endLine >= anchor.line, 'Code range must end at or after its first line.')

export const codeSelectionSnapshotSchema = domainRendererSelectionSnapshotSchema.extend({ codeAnchor: codeAnchorSchema.optional() })
  .refine(value => !value.codeAnchor || value.codeAnchor.code === value.quote, 'Code evidence must match the exact selected text.')
export type CodeSelectionSnapshot = z.infer<typeof codeSelectionSnapshotSchema>
