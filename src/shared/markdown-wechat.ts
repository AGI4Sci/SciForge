import { z } from 'zod'

export const MARKDOWN_COPY_FOR_WECHAT_ACTION_ID = 'markdown.copyForWechat'
export const MARKDOWN_COPY_FOR_FEISHU_ACTION_ID = 'markdown.copyForFeishu'
export const MARKDOWN_COPY_FOR_ZHIHU_ACTION_ID = 'markdown.copyForZhihu'

export const MARKDOWN_WECHAT_FEEDBACK_LIMITS = Object.freeze({
  maxWarnings: 40,
  maxWarningMessageChars: 500
})

export const MARKDOWN_COPY_SELECTION_LIMITS = Object.freeze({
  // Generous enough for selections embedding large base64 images; the
  // full-document copy path accepts unbounded Markdown, so the selection
  // path must not be the stricter one.
  maxHtmlChars: 40_000_000
})

export const MARKDOWN_WECHAT_WARNING_CODES = [
  'unsafe-link-removed',
  'local-link-removed',
  'remote-image-preserved',
  'image-unavailable',
  'image-unsafe',
  'formula-invalid',
  'code-language-fallback'
] as const

export const markdownWechatWarningCodeSchema = z.enum(MARKDOWN_WECHAT_WARNING_CODES)

export const markdownWechatWarningSchema = z.object({
  code: markdownWechatWarningCodeSchema,
  message: z.string().trim().min(1).max(MARKDOWN_WECHAT_FEEDBACK_LIMITS.maxWarningMessageChars),
  index: z.number().int().positive().optional()
}).strict()

export const markdownWechatCopyCountsSchema = z.object({
  formulas: z.number().int().nonnegative(),
  inlineFormulas: z.number().int().nonnegative(),
  displayFormulas: z.number().int().nonnegative(),
  codeBlocks: z.number().int().nonnegative(),
  embeddedImages: z.number().int().nonnegative(),
  remoteImages: z.number().int().nonnegative()
}).strict().refine(
  (counts) => counts.formulas === counts.inlineFormulas + counts.displayFormulas,
  { message: 'Formula count must equal inline plus display formulas.' }
)

export const markdownWechatCopyActionInputSchema = z.object({
  html: z.string().max(MARKDOWN_COPY_SELECTION_LIMITS.maxHtmlChars).optional()
}).strict()

export const markdownWechatRenderInputSchema = z.object({
  sourcePath: z.string().trim().min(1).max(4096),
  workspaceRoot: z.string().trim().min(1).max(4096).optional(),
  markdown: z.string()
}).strict()

export const markdownWechatSelectionInputSchema = z.object({
  sourcePath: z.string().trim().min(1).max(4096),
  workspaceRoot: z.string().trim().min(1).max(4096).optional(),
  html: z.string().min(1).max(MARKDOWN_COPY_SELECTION_LIMITS.maxHtmlChars)
}).strict()

export const markdownWechatCopyResultSchema = z.object({
  copiedAt: z.string().datetime({ offset: true }),
  outputBytes: z.number().int().nonnegative(),
  counts: markdownWechatCopyCountsSchema,
  warnings: z.array(markdownWechatWarningSchema).max(MARKDOWN_WECHAT_FEEDBACK_LIMITS.maxWarnings),
  effect: z.literal('clipboard-write')
}).strict()

export type MarkdownWechatWarningCode = z.infer<typeof markdownWechatWarningCodeSchema>
export type MarkdownWechatWarning = z.infer<typeof markdownWechatWarningSchema>
export type MarkdownWechatCopyCounts = z.infer<typeof markdownWechatCopyCountsSchema>
export type MarkdownWechatRenderInput = z.infer<typeof markdownWechatRenderInputSchema>
export type MarkdownWechatSelectionInput = z.infer<typeof markdownWechatSelectionInputSchema>
export type MarkdownWechatCopyResult = z.infer<typeof markdownWechatCopyResultSchema>
