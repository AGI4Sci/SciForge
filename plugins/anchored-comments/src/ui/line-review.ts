import type { AnchoredCommentThread } from '../core/contract'
import type { ProseTranslation, ProseTranslationInput } from '../core/contract'

type CodeAnchor = NonNullable<AnchoredCommentThread['anchor']['codeAnchor']>
export type AnchorMatch = { state: 'exact' | 'moved'; line: number } | { state: 'stale' | 'ambiguous' | 'unavailable' }

/** Compare only evidence from the same file, revision and diff side. Never rewrite saved anchors. */
export function resolveCodeAnchor(saved: CodeAnchor, current?: CodeAnchor): AnchorMatch {
  if (!current) return { state: 'unavailable' }
  if (saved.filePath !== current.filePath || saved.side !== current.side || saved.baseRevision !== current.baseRevision) return { state: 'stale' }
  if (saved.contentDigest === current.contentDigest && saved.line === current.line && saved.code === current.code) return { state: 'exact', line: saved.line }
  const needle = saved.code.replace(/\r\n/g, '\n').split('\n')
  const lines = current.code.replace(/\r\n/g, '\n').split('\n')
  if (!saved.code.trim()) return { state: 'stale' }
  const matches: number[] = []
  for (let index = 0; index <= lines.length - needle.length; index++) {
    if (needle.every((line, offset) => lines[index + offset] === line)) matches.push(current.line + index)
  }
  if (matches.length > 1) return { state: 'ambiguous' }
  if (!matches.length) return { state: 'stale' }
  return { state: matches[0] === saved.line ? 'exact' : 'moved', line: matches[0] }
}

export type LineReviewFilter = { search?: string; status?: AnchoredCommentThread['status'] | 'all'; workspaceKey?: string }
export type LineReviewFile = { filePath: string; lines: { line: number; side: CodeAnchor['side']; threads: AnchoredCommentThread[] }[] }

/** Stable file/line ordering; search includes prose and frozen code evidence. */
export function groupLineReviews(threads: readonly AnchoredCommentThread[], filter: LineReviewFilter = {}): LineReviewFile[] {
  const query = filter.search?.trim().toLocaleLowerCase() ?? ''
  const files = new Map<string, LineReviewFile>()
  for (const thread of threads) {
    const anchor = thread.anchor.codeAnchor
    if (!anchor || thread.purpose !== 'research' || (filter.workspaceKey && thread.workspaceKey !== filter.workspaceKey)) continue
    if (filter.status && filter.status !== 'all' && thread.status !== filter.status) continue
    if (query && ![anchor.filePath, anchor.code, thread.anchor.targetLabel, ...thread.messages.map(message => message.body)].some(text => text.toLocaleLowerCase().includes(query))) continue
    let file = files.get(anchor.filePath)
    if (!file) { file = { filePath: anchor.filePath, lines: [] }; files.set(anchor.filePath, file) }
    let line = file.lines.find(value => value.line === anchor.line && value.side === anchor.side)
    if (!line) { line = { line: anchor.line, side: anchor.side, threads: [] }; file.lines.push(line) }
    line.threads.push(thread)
  }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  return [...files.values()].sort((a, b) => compare(a.filePath, b.filePath)).map(file => ({ ...file,
    lines: file.lines.sort((a, b) => a.line - b.line || compare(a.side, b.side)).map(line => ({ ...line,
      threads: line.threads.sort((a, b) => compare(a.createdAt, b.createdAt) || compare(a.id, b.id)) })) }))
}

export function lineReviewList(initial: readonly AnchoredCommentThread[], onOpen: (threadId: string) => void, filter: LineReviewFilter = {}) {
  let threads = initial
  const root = document.createElement('section')
  root.setAttribute('aria-label', '逐行讨论')
  const search = document.createElement('input'); search.type = 'search'; search.value = filter.search ?? ''; search.setAttribute('aria-label', '搜索逐行讨论')
  const status = document.createElement('select'); status.setAttribute('aria-label', '讨论状态')
  for (const value of ['all', 'open', 'attached', 'ai_responded', 'awaiting_verification', 'resolved'] as const) {
    const option = document.createElement('option'); option.value = value; option.textContent = value; status.append(option)
  }
  status.value = filter.status ?? 'all'
  const content = document.createElement('div')
  const render = () => {
    content.replaceChildren()
    const groups = groupLineReviews(threads, { ...filter, search: search.value, status: status.value as LineReviewFilter['status'] })
    for (const file of groups) {
      const heading = document.createElement('h3'); heading.textContent = file.filePath; content.append(heading)
      for (const line of file.lines) for (const thread of line.threads) {
        const button = document.createElement('button'); button.type = 'button'
        button.textContent = `${line.side}:${line.line} · ${thread.status} · ${thread.messages[0]?.body ?? ''}${thread.anchorResolution === 'needs_retargeting' ? ' · 锚点待重新定位' : ''}`
        button.addEventListener('click', () => onOpen(thread.id)); content.append(button)
      }
    }
    if (!groups.length) content.textContent = '没有匹配的逐行讨论。'
  }
  search.addEventListener('input', render); status.addEventListener('change', render)
  root.append(search, status, content); render()
  return { root, update(next: readonly AnchoredCommentThread[]) { threads = next; render() } }
}

/** Translation is an optional view beside immutable original text. */
export function proseTranslationView(original: string, translate: (input: ProseTranslationInput, signal: AbortSignal) => Promise<ProseTranslation>, targetLanguage = 'zh-CN') {
  let alive = true, pending: AbortController | undefined
  const root = document.createElement('section'), source = document.createElement('p'), button = document.createElement('button'), output = document.createElement('p')
  source.textContent = original; button.type = 'button'; button.textContent = '翻译说明'
  output.setAttribute('role', 'status')
  button.addEventListener('click', async () => {
    if (!alive || pending) return
    const controller = new AbortController(); pending = controller; button.disabled = true; output.textContent = '正在翻译…'
    try {
      const result = await translate({ text: original, targetLanguage }, controller.signal)
      if (!alive || controller.signal.aborted) return
      if (result.original !== original || result.machineTranslated !== true || result.targetLanguage !== targetLanguage) throw new Error('翻译响应不匹配。')
      output.textContent = `机器翻译 · ${result.translation}`
    } catch (error) { if (alive && !controller.signal.aborted) output.textContent = String(error) }
    finally { if (pending === controller) { pending = undefined; button.disabled = false } }
  })
  root.append(source, button, output)
  return { root, dispose() { alive = false; pending?.abort(); root.remove() } }
}
