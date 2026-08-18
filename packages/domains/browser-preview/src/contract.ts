import { z } from 'zod'

export const BROWSER_PREVIEW_RESOURCE_KIND = 'browser-page'
export const BROWSER_PREVIEW_TRUST = 'untrusted-web-content' as const
export const DEFAULT_BROWSER_PREVIEW_URL = 'http://localhost:5173/'

export const BROWSER_PREVIEW_CAPABILITY_IDS = Object.freeze({
  open: 'browser-preview.open',
  close: 'browser-preview.close',
  read: 'browser-preview.read',
  navigate: 'browser-preview.navigate',
  back: 'browser-preview.back',
  forward: 'browser-preview.forward',
  reload: 'browser-preview.reload',
  click: 'browser-preview.click',
  fill: 'browser-preview.fill',
  select: 'browser-preview.select',
  press: 'browser-preview.press'
} as const)

export const browserCapabilityResourceHandleSchema = z.object({
  token: z.string().regex(/^cap_[A-Za-z0-9_-]{20,}$/u),
  semanticRevision: z.string().trim().min(1).max(256),
  expiresAt: z.string().datetime({ offset: true })
}).strict()

export const browserOpenInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  surfaceId: z.string().trim().min(1).max(256),
  url: z.string().trim().min(1).max(4096).default(DEFAULT_BROWSER_PREVIEW_URL)
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
export const browserNavigateInputSchema = z.object({
  url: z.string().trim().min(1).max(4096)
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

export const browserActionOutputSchema = z.object({
  ok: z.literal(true),
  url: z.string().max(4096),
  title: z.string().max(1024),
  semanticRevision: z.string().min(1).max(256)
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
  screenshotDataUrl: z.string().max(4_000_000).optional()
}).strict()

export type BrowserPageState = z.infer<typeof browserPageStateSchema>
export type BrowserOpenInput = z.infer<typeof browserOpenInputSchema>
export type BrowserActionOutput = z.infer<typeof browserActionOutputSchema>
