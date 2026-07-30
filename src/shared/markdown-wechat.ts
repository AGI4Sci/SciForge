import { z } from 'zod'

export const MARKDOWN_COPY_FOR_WECHAT_ACTION_ID = 'markdown.copyForWechat'

export const MARKDOWN_WECHAT_LIMITS = Object.freeze({
  maxMarkdownChars: 1_000_000,
  maxOutputBytes: 20_000_000,
  maxWarnings: 40,
  maxWarningMessageChars: 500,
  maxFormulas: 500,
  maxImages: 100,
  maxImageBytes: 8 * 1024 * 1024,
  maxTotalImageBytes: 16 * 1024 * 1024
})

export const MARKDOWN_WECHAT_WARNING_CODES = [
  'raw-html-omitted',
  'unsafe-link-removed',
  'local-link-removed',
  'remote-image-preserved',
  'image-unavailable',
  'image-unsafe',
  'image-too-large',
  'image-limit-exceeded',
  'formula-invalid',
  'code-language-fallback'
] as const

export const markdownWechatWarningCodeSchema = z.enum(MARKDOWN_WECHAT_WARNING_CODES)

export const markdownWechatWarningSchema = z.object({
  code: markdownWechatWarningCodeSchema,
  message: z.string().trim().min(1).max(MARKDOWN_WECHAT_LIMITS.maxWarningMessageChars),
  index: z.number().int().positive().max(
    Math.max(MARKDOWN_WECHAT_LIMITS.maxFormulas, MARKDOWN_WECHAT_LIMITS.maxImages)
  ).optional()
}).strict()

export const markdownWechatCopyCountsSchema = z.object({
  formulas: z.number().int().nonnegative().max(MARKDOWN_WECHAT_LIMITS.maxFormulas),
  inlineFormulas: z.number().int().nonnegative().max(MARKDOWN_WECHAT_LIMITS.maxFormulas),
  displayFormulas: z.number().int().nonnegative().max(MARKDOWN_WECHAT_LIMITS.maxFormulas),
  codeBlocks: z.number().int().nonnegative().max(10_000),
  embeddedImages: z.number().int().nonnegative().max(MARKDOWN_WECHAT_LIMITS.maxImages),
  remoteImages: z.number().int().nonnegative().max(MARKDOWN_WECHAT_LIMITS.maxImages)
}).strict().refine(
  (counts) => counts.formulas === counts.inlineFormulas + counts.displayFormulas,
  { message: 'Formula count must equal inline plus display formulas.' }
)

export const markdownWechatCopyActionInputSchema = z.object({}).strict()

export const markdownWechatRenderInputSchema = z.object({
  sourcePath: z.string().trim().min(1).max(4096),
  workspaceRoot: z.string().trim().min(1).max(4096).optional(),
  markdown: z.string().max(MARKDOWN_WECHAT_LIMITS.maxMarkdownChars)
}).strict()

export const markdownWechatCopyResultSchema = z.object({
  copiedAt: z.string().datetime({ offset: true }),
  outputBytes: z.number().int().nonnegative().max(MARKDOWN_WECHAT_LIMITS.maxOutputBytes),
  counts: markdownWechatCopyCountsSchema,
  warnings: z.array(markdownWechatWarningSchema).max(MARKDOWN_WECHAT_LIMITS.maxWarnings),
  effect: z.literal('clipboard-write')
}).strict()

export type MarkdownWechatWarningCode = z.infer<typeof markdownWechatWarningCodeSchema>
export type MarkdownWechatWarning = z.infer<typeof markdownWechatWarningSchema>
export type MarkdownWechatCopyCounts = z.infer<typeof markdownWechatCopyCountsSchema>
export type MarkdownWechatRenderInput = z.infer<typeof markdownWechatRenderInputSchema>
export type MarkdownWechatCopyResult = z.infer<typeof markdownWechatCopyResultSchema>
