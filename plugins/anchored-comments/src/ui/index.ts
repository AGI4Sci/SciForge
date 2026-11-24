import { anchoredCommentListResultSchema, anchoredCommentThreadSchema } from '../core/contract.js'
import { boundSelection, selectionFromResource, selectionCommentInput, type SelectionHostScope } from '../selection.js'
import type { CommentSelection } from '../selection.js'
import './style.css'
import { conversationView } from './conversation'
import { lineReviewList } from './line-review'
import { sharedConversationsPanel } from './shared-conversations'
import type { AnchoredCommentThread } from '../core/contract'

// The existing sandbox is the transport; context does not authorize writes.
const root = document.getElementById('root')!
const make = <T extends keyof HTMLElementTagNameMap>(tag: T, text?: string) => {
  const element = document.createElement(tag); if (text) element.textContent = text; return element
}
root.append(make('h1', '锚定批注'), make('p', '在研究记录中选中文字，点击“添加批注”，然后填写正文并保存。文字快照不代表来源已验证。'))
const label = make('strong'), quote = make('blockquote'), origin = make('small')
const advanced = make('details'), selectionLabel = make('label', '选区定位 JSON'), selection = make('textarea')
selectionLabel.append(selection); advanced.append(make('summary', '高级：手动导入定位'), selectionLabel)
const bodyLabel = make('label', '批注内容'), body = make('textarea'); bodyLabel.append(body)
const save = make('button', '保存批注'), refresh = make('button', '刷新已有批注'), notice = make('p'), list = make('section')
const replacement = make('section'), replace = make('button', '放弃旧正文并替换选区'), keep = make('button', '保留当前草稿')
replacement.hidden = true; replacement.append(make('p', '收到新选区，当前有未保存正文。请选择保留或替换。'), keep, replace)
notice.id = 'notice'; notice.setAttribute('role', 'status'); list.setAttribute('aria-label', '已有批注')
root.append(label, quote, origin, advanced, bodyLabel, replacement, save, refresh, notice, list)
let host: SelectionHostScope = { workspaceRoot: '', sessionId: '', runtimeId: '' }
let capabilities = new Set<string>(), epoch = 0, busy = false
let current: CommentSelection | undefined, queued: CommentSelection | undefined
let draft: ReturnType<typeof selectionCommentInput> | undefined
const pending = new Map<string, { resolve: (output: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const conversations = new Map<string, ReturnType<typeof conversationView>>()
const threads = new Map<string, AnchoredCommentThread>()
const floating = () => window.parent.postMessage({ type: 'presentation.set', input: { mode: 'floating' } }, '*')
const refreshNavigation = () => {
  for (const [id, view] of conversations) view.setChildren([...threads.values()].filter(thread => thread.fork?.parentThreadId === id))
}
const navigate = async (id: string) => {
  const version = epoch
  try {
    const result = await invoke('anchored-comments.get', { threadId: id }) as { thread?: unknown }
    if (version !== epoch) return
    const thread = anchoredCommentThreadSchema.parse(result.thread)
    if (thread.id !== id || thread.workspaceKey !== host.workspaceRoot) throw new Error('讨论身份不匹配。')
    openConversation(thread)
  } catch (error) { if (version === epoch) notice.textContent = String(error) }
}
const openConversation = (thread: AnchoredCommentThread) => {
  threads.set(thread.id, thread)
  reviews.update([...threads.values()]); sharedPanel.refreshLocalThreads()
  floating()
  document.body.classList.add('conversations-open')
  const existing = conversations.get(thread.id)
  if (existing) { existing.update(thread); existing.reopen(root) }
  else {
    const view = conversationView(thread, invoke, openConversation, id => void navigate(id), () => {
      if (![...conversations.values()].some(view => view.root.isConnected)) document.body.classList.remove('conversations-open')
    }, updated => {
      threads.set(updated.id, updated)
      reviews.update([...threads.values()]); sharedPanel.refreshLocalThreads()
    })
    conversations.set(thread.id, view); root.append(view.root)
  }
  refreshNavigation()
  const visible = conversations.get(thread.id)?.root
  if (visible) root.scrollLeft = visible.offsetLeft
}
const controls = () => {
  save.disabled = busy || !current || !host.runtimeId || !host.sessionId || !capabilities.has('anchored-comments.upsert')
  refresh.disabled = busy || !host.workspaceRoot || !capabilities.has('anchored-comments.list')
  replace.disabled = busy; keep.disabled = busy; body.disabled = busy; selection.disabled = busy
}
const clear = (message: string) => {
  for (const view of conversations.values()) view.dispose(false)
  conversations.clear()
  threads.clear(); document.body.classList.remove('conversations-open')
  reviews.update([]); sharedPanel.resetScope()
  epoch++; busy = false; draft = undefined; current = undefined; queued = undefined
  selection.value = ''; body.value = ''; label.textContent = ''; quote.textContent = ''; origin.textContent = ''
  replacement.hidden = true; list.replaceChildren()
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)) }
  pending.clear(); notice.textContent = message; controls()
}
const applySelection = (value: CommentSelection) => {
  current = value; queued = undefined; draft = undefined; selection.value = JSON.stringify(value, null, 2)
  if (value.codeAnchor) floating()
  label.textContent = value.label; quote.textContent = value.quote
  origin.textContent = `${value.scope.runtimeId} / ${value.scope.threadId} · ${value.resourceId} · 来源仍待核对`
  replacement.hidden = true; controls(); notice.textContent = '选区已带入。请填写正文并保存；尚未保存批注。'
}
const receiveSelection = (value: CommentSelection) => {
  if (JSON.stringify(current) === JSON.stringify(value)) return
  if (current && (body.value.trim() || busy)) { queued = value; replacement.hidden = false; controls(); return }
  applySelection(value)
}
controls()
const invoke = (actionId: string, input: unknown): Promise<unknown> => {
  if (!capabilities.has(actionId) || !host.workspaceRoot) return Promise.reject(new Error('插件未获准执行此操作，或当前没有工作区。'))
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('操作结果未知：宿主响应超时。请先刷新核对；不会自动重试。')) }, 120000)
    pending.set(requestId, { resolve, reject, timer })
    window.parent.postMessage({ type: 'capability.invoke', requestId, actionId,
      input: { ...(input as Record<string, unknown>), workspaceRoot: host.workspaceRoot } }, '*')
  })
}
const reviews = lineReviewList([], id => void navigate(id))
const sharedPanel = sharedConversationsPanel({ invoke, listLocalThreads: () => [...threads.values()] })
root.append(reviews.root, sharedPanel.root)
const reconcileCurrent = async (version: number) => {
  const snapshot = current?.codeAnchor
  if (!snapshot || !capabilities.has('anchored-comments.anchor.reconcile')) return
  for (const saved of [...threads.values()]) {
    const anchor = saved.anchor.codeAnchor
    if (!anchor || anchor.filePath !== snapshot.filePath || anchor.side !== snapshot.side) continue
    // Selection digests describe only selected code; unrelated ranges are not evidence of change.
    if (anchor.line !== snapshot.line || (anchor.endLine ?? anchor.line) !== (snapshot.endLine ?? snapshot.line)) continue
    const result = anchoredCommentThreadSchema.parse(await invoke('anchored-comments.anchor.reconcile', { threadId: saved.id, current: snapshot }))
    if (version !== epoch) return
    if (result.id !== saved.id || result.workspaceKey !== host.workspaceRoot) throw new Error('定位核对响应身份不匹配。')
    threads.set(result.id, result); conversations.get(result.id)?.update(result)
  }
}
const reload = async () => {
  const version = epoch
  const result = anchoredCommentListResultSchema.parse(await invoke('anchored-comments.list', { purpose: 'research', includeResolved: true }))
  if (version !== epoch) return
  threads.clear()
  list.replaceChildren()
  for (const thread of result.threads.slice(0, 200)) {
    threads.set(thread.id, thread)
    conversations.get(thread.id)?.update(thread)
    if (thread.anchor.codeAnchor) continue
    const article = make('article'); article.append(make('strong', thread.anchor.targetLabel), make('p', thread.status + ' · ' + thread.anchorResolution))
    const text = thread.anchor.canonical.selection?.quote
    if (typeof text === 'string') article.append(make('blockquote', text))
    for (const message of thread.messages) article.append(make('p', message.body))
    const details = make('details'); details.append(make('summary', '精确定位与原始记录'), make('pre', JSON.stringify(thread, null, 2))); article.append(details); list.append(article)
  }
  await reconcileCurrent(version)
  if (version !== epoch) return
  refreshNavigation()
  reviews.update([...threads.values()])
  sharedPanel.refreshLocalThreads()
  notice.textContent = '已读取 ' + result.threads.length + ' 条批注' + (result.threads.length > 200 ? '；本页展示前 200 条，请用公开 list/get 工具检索其余记录。' : '。来源仍待核对。')
}
const run = async (operation: () => Promise<void>) => {
  if (busy) return
  const version = epoch; busy = true; controls(); notice.textContent = '正在处理…'
  try { await operation() } catch (error) { if (version === epoch) notice.textContent = error instanceof Error ? error.message : String(error) }
  finally { if (version === epoch) { busy = false; controls() } }
}
selection.addEventListener('change', () => {
  try { receiveSelection(boundSelection(JSON.parse(selection.value), host)) }
  catch (error) { clear(error instanceof Error ? error.message : String(error)) }
})
body.addEventListener('input', () => { draft = undefined })
replace.addEventListener('click', () => { if (queued && !busy) { body.value = ''; applySelection(queued) } })
keep.addEventListener('click', () => { queued = undefined; replacement.hidden = true; notice.textContent = '已保留当前草稿及原选区。' })
save.addEventListener('click', () => void run(async () => {
  const version = epoch
  const input = draft ??= selectionCommentInput(current, body.value, host, crypto.randomUUID(), new Date().toISOString())
  const result = anchoredCommentThreadSchema.parse(await invoke('anchored-comments.upsert', input))
  if (result.id !== input.thread.id) throw new Error('宿主返回的批注身份不匹配；请刷新核对。')
  if (version !== epoch) return
  draft = undefined; body.value = ''
  if (result.anchor.codeAnchor) openConversation(result)
  if (capabilities.has('anchored-comments.list')) await reload()
  if (version === epoch) notice.textContent = '批注已保存。原始选区快照保留；来源是否变化仍待核对。'
}))
refresh.addEventListener('click', () => void run(reload))
window.addEventListener('message', event => {
  if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return
  const data = event.data
  if (data.type === 'host.init') {
    const next = { workspaceRoot: typeof data.workspaceRoot === 'string' ? data.workspaceRoot : '',
      sessionId: typeof data.sessionId === 'string' ? data.sessionId : '', runtimeId: typeof data.runtimeId === 'string' ? data.runtimeId : '' }
    const nextCapabilities = Array.isArray(data.capabilityIds) ? data.capabilityIds.filter((value: unknown): value is string => typeof value === 'string') : []
    const changed = JSON.stringify(next) !== JSON.stringify(host) || JSON.stringify([...capabilities].sort()) !== JSON.stringify([...nextCapabilities].sort())
    host = next; capabilities = new Set(nextCapabilities)
    if (changed) clear('面板权限或会话已变化，旧草稿和待处理请求已清除。请刷新核对上次操作。')
    if (!host.workspaceRoot || !host.sessionId || !host.runtimeId) { clear('宿主未提供完整工作区/runtime/会话身份；无法安全导入选区或保存。'); return }
    if (!capabilities.has('anchored-comments.upsert')) { clear('插件未获准保存批注；尚未保存。'); return }
    try { receiveSelection(selectionFromResource(data.activation?.payload?.resource, host)) }
    catch (error) { clear('选区上下文无效：' + (error instanceof Error ? error.message : String(error))) }
    controls()
  }
  if (data.type === 'capability.result' && typeof data.requestId === 'string') {
    const request = pending.get(data.requestId); if (!request) return
    clearTimeout(request.timer); pending.delete(data.requestId)
    if (data.ok === false) request.reject(new Error(data.error?.message || '宿主拒绝了此操作。'))
    else request.resolve(data.output)
  }
  if (data.type === 'dispose') { host = { workspaceRoot: '', sessionId: '', runtimeId: '' }; capabilities.clear(); clear('插件已停用，旧草稿已清除。'); sharedPanel.dispose() }
})
window.parent.postMessage({ type: 'ready' }, '*')
