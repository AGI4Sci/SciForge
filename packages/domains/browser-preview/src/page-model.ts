import type { BrowserPageState } from './contract.js'

/** A normalized observation from every available page sensing channel. */
export type PageModel = Readonly<{
  url: string
  title: string
  revision: string
  text: string
  targets: readonly PageModelTarget[]
  visual?: PageModelVisual
  truncated: boolean
}>

export type PageModelTarget = Readonly<{
  targetRef: string
  source: 'dom' | 'aria' | 'cdp' | 'visual'
  role?: string
  name?: string
  bounds?: Readonly<{ x: number; y: number; width: number; height: number }>
  confidence?: number
}>

export type PageModelVisual = Readonly<{
  mimeType: string
  width: number
  height: number
  /** Optional provider supplied description (OCR/vision). */
  description?: string
  bytes?: Uint8Array
}>

export type PageModelInput = Readonly<{
  page: Pick<BrowserPageState, 'url' | 'title' | 'ariaSnapshot' | 'targets' | 'truncated'>
  revision: string
  visual?: PageModelVisual
  extraText?: string
  extraTargets?: readonly PageModelTarget[]
}>

/**
 * Merge DOM/ARIA, CDP and visual observations into one deterministic model.
 * Semantic targets retain their stable refs; visual targets are additive and
 * never replace an actionable DOM target.
 */
export function mergePageModel(input: PageModelInput): PageModel {
  const targets = new Map<string, PageModelTarget>()
  for (const target of input.page.targets) {
    targets.set(target.targetRef, { targetRef: target.targetRef, source: 'dom' })
  }
  for (const target of input.extraTargets ?? []) {
    const existing = targets.get(target.targetRef)
    if (!existing || existing.source === 'visual') targets.set(target.targetRef, target)
    else targets.set(target.targetRef, { ...target, source: existing.source })
  }
  const textParts = [input.page.ariaSnapshot.trim(), input.extraText?.trim() ?? ''].filter(Boolean)
  return Object.freeze({
    url: input.page.url,
    title: input.page.title,
    revision: input.revision,
    text: textParts.join('\n'),
    targets: Object.freeze([...targets.values()]),
    visual: input.visual,
    truncated: input.page.truncated
  })
}
