export type CdpSemanticNode = Readonly<{
  tag: string
  role: string
  name: string
  center: readonly [number, number]
  disabled: boolean
  current: string
  selected: string
  expanded: string
  pressed: string
}>

export type CdpClickReadback = Readonly<{
  url: string
  activeName: string
  targetName: string
  targetState: string
}>

export const CDP_SEMANTIC_TREE_EXPRESSION = `(() => { /* sciforge-computer-use-semantic-tree-v1 */
  const text = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 512)
  const name = (element) => text(
    element.getAttribute('aria-label') || element.getAttribute('title') ||
    element.getAttribute('alt') || element.getAttribute('placeholder') ||
    element.innerText || element.textContent
  )
  const selectors = [
    'button', 'a', 'input:not([type="hidden"])', 'select', 'textarea',
    '[role]', '[aria-label]', 'h1', 'h2', 'h3', 'output'
  ].join(',')
  return [...document.querySelectorAll(selectors)].flatMap((element) => {
    if (!(element instanceof HTMLElement)) return []
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') return []
    const center = [
      Math.round(Math.max(0, Math.min(1000, ((rect.left + rect.width / 2) / Math.max(1, innerWidth)) * 1000))),
      Math.round(Math.max(0, Math.min(1000, ((rect.top + rect.height / 2) / Math.max(1, innerHeight)) * 1000)))
    ]
    return [{
      tag: element.tagName.toLowerCase(),
      role: text(element.getAttribute('role')),
      name: name(element),
      center,
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      current: text(element.getAttribute('aria-current')),
      selected: text(element.getAttribute('aria-selected')),
      expanded: text(element.getAttribute('aria-expanded')),
      pressed: text(element.getAttribute('aria-pressed'))
    }]
  }).filter((item) => item.name || item.role).slice(0, 256)
})()`

export const CDP_RENDERER_SETTLE_EXPRESSION = `new Promise((resolve) => { /* sciforge-computer-use-renderer-settle-v1 */
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    setTimeout(resolve, 50)
  }
  setTimeout(finish, 250)
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(finish))
  } else {
    finish()
  }
})`

export const CDP_CSS_VIEWPORT_EXPRESSION = `(() => { /* sciforge-computer-use-css-viewport-v1 */
  return { width: Math.max(1, innerWidth), height: Math.max(1, innerHeight) }
})()`

export function cdpClickReadbackExpression(x: number, y: number): string {
  return `(() => { /* sciforge-computer-use-click-readback-v1 */
    const text = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 512)
    const describe = (element) => element instanceof HTMLElement ? {
      name: text(element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent),
      state: [
        element.getAttribute('aria-current'), element.getAttribute('aria-selected'),
        element.getAttribute('aria-expanded'), element.getAttribute('aria-pressed')
      ].map(text).join('|')
    } : { name: '', state: '' }
    const active = describe(document.activeElement)
    const target = describe(document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)}))
    return { url: String(location.href).slice(0, 2048), activeName: active.name, targetName: target.name, targetState: target.state }
  })()`
}

export function normalizeCdpSemanticTree(value: unknown): CdpSemanticNode[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 256).flatMap((item) => {
    const candidate = asRecord(item)
    const center = Array.isArray(candidate.center) ? candidate.center : []
    if (center.length !== 2 || !center.every((part) => Number.isFinite(part))) return []
    return [{
      tag: boundedText(candidate.tag),
      role: boundedText(candidate.role),
      name: boundedText(candidate.name),
      center: center.map((part) => Math.max(0, Math.min(1000, Math.round(Number(part))))) as [number, number],
      disabled: candidate.disabled === true,
      current: boundedText(candidate.current),
      selected: boundedText(candidate.selected),
      expanded: boundedText(candidate.expanded),
      pressed: boundedText(candidate.pressed)
    }]
  })
}

export function normalizeCdpClickReadback(value: unknown): CdpClickReadback {
  const record = asRecord(value)
  return {
    url: boundedText(record.url, 2048),
    activeName: boundedText(record.activeName),
    targetName: boundedText(record.targetName),
    targetState: boundedText(record.targetState)
  }
}

export function verifyCdpClick(
  before: CdpClickReadback,
  after: CdpClickReadback,
  beforeSemanticTree: readonly CdpSemanticNode[],
  afterSemanticTree: readonly CdpSemanticNode[]
): Record<string, unknown> {
  if (before.url !== after.url) {
    return { status: 'verified', details: { reason: 'url-changed' } }
  }
  if (before.targetState !== after.targetState && after.targetState) {
    return { status: 'verified', details: { reason: 'target-state-changed' } }
  }
  if (
    before.targetName && after.activeName &&
    after.activeName === before.targetName && after.activeName !== before.activeName
  ) {
    return { status: 'verified', details: { reason: 'clicked-element-focused' } }
  }
  if (JSON.stringify(beforeSemanticTree) !== JSON.stringify(afterSemanticTree)) {
    return { status: 'verified', details: { reason: 'semantic-tree-changed' } }
  }
  return { status: 'unverified', details: { reason: 'click-has-no-semantic-readback' } }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function boundedText(value: unknown, max = 512): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max)
}
