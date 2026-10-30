import { z } from 'zod'

export const BROWSER_PREVIEW_RESOURCE_KIND = 'browser-page'
export const BROWSER_PREVIEW_TRUST = 'untrusted-web-content' as const
/** Neutral document used when a browser surface has no user destination yet. */
export const DEFAULT_BROWSER_PREVIEW_URL = 'about:blank'

export const BROWSER_PREVIEW_CAPABILITY_IDS = Object.freeze({
  open: 'browser-preview.open',
  close: 'browser-preview.close',
  read: 'browser-preview.read',
  readUrl: 'browser-preview.read-url',
  navigate: 'browser-preview.navigate',
  back: 'browser-preview.back',
  forward: 'browser-preview.forward',
  reload: 'browser-preview.reload',
  present: 'browser-preview.present',
  click: 'browser-preview.click',
  fill: 'browser-preview.fill',
  select: 'browser-preview.select',
  press: 'browser-preview.press',
  scroll: 'browser-preview.scroll',
  hover: 'browser-preview.hover',
  drag: 'browser-preview.drag',
  download: 'browser-preview.download'
} as const)

export const browserCapabilityResourceHandleSchema = z.object({
  token: z.string().regex(/^cap_[A-Za-z0-9_-]{20,}$/u),
  semanticRevision: z.string().trim().min(1).max(256),
  expiresAt: z.string().datetime({ offset: true })
}).strict()

export const browserOpenInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  surfaceId: z.string().trim().min(1).max(256),
  // A capability open must always be explicit about its destination. The
  // renderer may use the neutral initial document for an empty panel, but an
  // agent invocation must never silently navigate to a development server.
  url: z.string().trim().min(1).max(4096)
}).strict()

export const browserOpenOutputSchema = z.object({
  resource: browserCapabilityResourceHandleSchema,
  sessionId: z.string().trim().min(1).max(256),
  surfaceId: z.string().trim().min(1).max(256)
}).strict()

export const browserCloseOutputSchema = z.object({
  closed: z.literal(true)
}).strict()

export const browserEmptyInputSchema = z.object({}).strict()
export const browserReadInputSchema = z.object({
  /** Character offset into the current accessibility snapshot. */
  offset: z.number().int().min(0).max(1_000_000).default(0),
  /** Keep each read small enough to survive the model request boundary. */
  maxChars: z.number().int().min(500).max(5_000).default(4_000)
}).strict()
/** URL-first bounded reader. The returned text and metadata are untrusted web data. */
export const browserReadUrlInputSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  maxChars: z.number().int().min(500).max(20_000).default(8_000)
}).strict()
export const browserReadUrlOutputSchema = z.object({
  trust: z.literal(BROWSER_PREVIEW_TRUST),
  safetyNotice: z.string().min(1).max(1000),
  requestedUrl: z.string().max(4096),
  finalUrl: z.string().max(4096),
  status: z.number().int().min(0).max(999),
  contentType: z.string().max(256),
  content: z.string().max(20_000),
  truncated: z.boolean(),
  needsBrowser: z.boolean(),
  readOffset: z.number().int().nonnegative(),
  totalChars: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().optional(),
  reason: z.enum(['none', 'authentication-required', 'javascript-required', 'unsupported-content-type', 'timeout', 'network-error', 'http-error']).optional()
}).strict()
export const browserNavigateInputSchema = z.object({
  url: z.string().trim().min(1).max(4096)
}).strict()
export const browserPresentationInputSchema = z.object({
  x: z.number().finite().min(0).max(32768),
  y: z.number().finite().min(0).max(32768),
  width: z.number().finite().min(0).max(8192),
  height: z.number().finite().min(0).max(8192),
  visible: z.boolean()
}).strict()
export const browserClickInputSchema = z.union([
  z.object({ targetRef: z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u) }).strict(),
  z.object({
    x: z.number().finite().nonnegative().max(4096),
    y: z.number().finite().nonnegative().max(4096)
  }).strict()
])
export const browserFillInputSchema = z.object({
  targetRef: z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u),
  text: z.string().max(20_000)
}).strict()
export const browserSelectInputSchema = z.object({
  targetRef: z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u),
  value: z.string().max(2_000)
}).strict()
export const browserPressInputSchema = z.object({
  targetRef: z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u),
  key: z.enum([
    'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Space'
  ])
}).strict()
const browserPointSchema = z.object({ x: z.number().finite().nonnegative().max(4096), y: z.number().finite().nonnegative().max(4096) }).strict()
export const browserScrollInputSchema = z.object({
  targetRef: z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u).optional(),
  x: z.number().finite().nonnegative().max(4096).optional(), y: z.number().finite().nonnegative().max(4096).optional(),
  deltaX: z.number().finite().min(-100000).max(100000).default(0), deltaY: z.number().finite().min(-100000).max(100000).default(600)
}).strict()
export const browserHoverInputSchema = z.union([
  z.object({ targetRef: z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u) }).strict(), browserPointSchema
])
export const browserDragInputSchema = z.object({ from: browserPointSchema, to: browserPointSchema, durationMs: z.number().int().min(0).max(5000).default(100) }).strict()
export const browserDownloadInputSchema = z.object({
  url: z.string().trim().min(1).max(4096).optional(),
  fileName: z.string().trim().min(1).max(255).optional()
}).strict()
export const browserDownloadOutputSchema = z.object({
  ok: z.literal(true),
  path: z.string().min(1).max(4096),
  fileName: z.string().min(1).max(255),
  bytes: z.number().int().nonnegative(),
  url: z.string().max(4096)
}).strict()

export const browserActionOutputSchema = z.object({
  ok: z.literal(true),
  url: z.string().max(4096),
  title: z.string().max(1024),
  semanticRevision: z.string().min(1).max(256),
  scroll: z.object({
    changed: z.boolean(),
    beforeTop: z.number().finite().nonnegative(),
    afterTop: z.number().finite().nonnegative(),
    maxTop: z.number().finite().nonnegative(),
    atStart: z.boolean(),
    atEnd: z.boolean()
  }).strict().optional()
}).strict()

export const browserTargetSchema = z.object({
  targetRef: z.string().regex(/^target_[A-Za-z0-9_-]{20,}$/u)
}).strict()

export const browserPageStateSchema = z.object({
  trust: z.literal(BROWSER_PREVIEW_TRUST),
  safetyNotice: z.string().min(1).max(1000),
  sessionId: z.string().min(1).max(256),
  surfaceId: z.string().min(1).max(256),
  url: z.string().max(4096),
  title: z.string().max(1024),
  status: z.enum(['starting', 'ready', 'loading', 'error', 'closed']),
  error: z.string().max(2000).nullable(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  viewport: z.object({
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096)
  }).strict(),
  ariaSnapshot: z.string().max(60_000),
  targets: z.array(browserTargetSchema).max(512),
  truncated: z.boolean(),
  readOffset: z.number().int().nonnegative().optional(),
  totalChars: z.number().int().nonnegative().optional(),
  nextOffset: z.number().int().nonnegative().optional()
}).strict()

export type BrowserPageState = z.infer<typeof browserPageStateSchema>
export type BrowserOpenInput = z.infer<typeof browserOpenInputSchema>
export type BrowserActionOutput = z.infer<typeof browserActionOutputSchema>
export type BrowserReadInput = z.infer<typeof browserReadInputSchema>
export type BrowserReadUrlInput = z.infer<typeof browserReadUrlInputSchema>
export type BrowserReadUrlOutput = z.infer<typeof browserReadUrlOutputSchema>
export type BrowserPresentationInput = z.infer<typeof browserPresentationInputSchema>
