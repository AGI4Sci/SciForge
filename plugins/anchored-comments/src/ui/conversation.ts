import { anchoredCommentReplyResultSchema, anchoredCommentThreadSchema, type AnchoredCommentThread } from '../core/contract'
import { proseTranslationView } from './line-review'
import { proseTranslationResultSchema } from '../core/contract'

type Client = (actionId: string, input: unknown) => Promise<unknown>

/** Each mounted conversation owns its draft, scroll position and response fence. */
export function conversationView(initial: AnchoredCommentThread, invoke: Client, onFork: (child: AnchoredCommentThread) => void, navigate: (id: string) => void = () => {}, onClose: () => void = () => {}, onChange: (thread: AnchoredCommentThread) => void = () => {}) {
  let thread = initial, alive = true, requestId: string | undefined
  let lifetime = 0, disposed = false
  let forking = false
  let retry: { requestId: string; body: string } | undefined
  let forkRetry: { childId: string; messageId: string; body: string } | undefined
  const translations: ReturnType<typeof proseTranslationView>[] = []
  const clearTranslations = () => { for (const view of translations.splice(0)) view.dispose() }
  const root = document.createElement('section')
  root.className = 'conversation'
  root.setAttribute('aria-label', `代码讨论 ${thread.anchor.targetLabel}`)
  const header = document.createElement('header')
  const title = document.createElement('strong')
  title.textContent = thread.fork ? '分叉讨论' : '代码讨论'
  const close = document.createElement('button')
  close.textContent = '关闭'; close.setAttribute('aria-label', '关闭代码讨论')
  header.append(title, close)
  const navigation = document.createElement('nav')
  const setChildren = (children: AnchoredCommentThread[]) => {
    navigation.replaceChildren()
    if (thread.fork) {
      const parent = document.createElement('button'); parent.textContent = '父讨论'
      parent.addEventListener('click', () => navigate(thread.fork!.parentThreadId)); navigation.append(parent)
    }
    children.forEach((child, index) => {
      const button = document.createElement('button'); button.textContent = `分叉 ${index + 1}`
      button.addEventListener('click', () => navigate(child.id)); navigation.append(button)
    })
  }
  const code = document.createElement('pre')
  code.className = 'conversation-code'
  code.textContent = `${thread.anchor.codeAnchor!.filePath}:${thread.anchor.codeAnchor!.line}\n${thread.anchor.codeAnchor!.code}`
  const history = document.createElement('div')
  let hiddenScrollTop = 0
  history.className = 'conversation-history'
  history.setAttribute('role', 'log')
  const draft = document.createElement('textarea')
  draft.placeholder = '继续提问，或选择某条消息分叉'
  draft.setAttribute('aria-label', '讨论问题')
  const send = document.createElement('button'), cancel = document.createElement('button')
  send.textContent = '发送'; cancel.textContent = '停止'; cancel.disabled = true
  const notice = document.createElement('p')
  notice.className = 'conversation-notice'
  notice.setAttribute('role', 'status')
  const render = () => {
    const scrollTop = history.scrollTop
    clearTranslations()
    history.replaceChildren()
    if (thread.fork) {
      const inherited = document.createElement('details')
      const summary = document.createElement('summary')
      summary.textContent = `继承上下文 · ${thread.fork.messages.length} 条${thread.fork.truncated ? ' · 已截断' : ''}`
      inherited.append(summary)
      for (const message of thread.fork.messages) {
        const text = document.createElement('p'); text.textContent = message.body; inherited.append(text)
      }
      history.append(inherited)
    }
    for (const message of thread.messages) {
      const article = document.createElement('article'), author = document.createElement('small')
      author.textContent = message.authorKind === 'ai' ? `AI · ${message.authorId ?? '运行时'}` : '你'
      const fork = document.createElement('button'); fork.textContent = '从这里分叉'; fork.disabled = Boolean(requestId) || forking
      fork.addEventListener('click', async () => {
        if (!alive || requestId || forking) return
        if (retry) { notice.textContent = '上次回复结果未知，请先恢复原问题并重试。'; return }
        if (!draft.value.trim()) { notice.textContent = '先填写分叉问题。'; draft.focus(); return }
        const body = draft.value.trim()
        if (forkRetry && (forkRetry.messageId !== message.id || forkRetry.body !== body)) {
          notice.textContent = '上次分叉结果未知。请恢复原问题及分叉消息后重试，或关闭后刷新核对。'
          return
        }
        const childId = forkRetry?.childId ?? crypto.randomUUID()
        const version = lifetime
        forkRetry = { childId, messageId: message.id, body }
        forking = true; send.disabled = true
        for (const button of history.querySelectorAll('button')) button.disabled = true
        try {
          const child = anchoredCommentThreadSchema.parse(await invoke('anchored-comments.conversation.fork', {
            threadId: thread.id, messageId: message.id, childId, body
          }))
          if (!alive || version !== lifetime) return
          if (child.id !== childId || child.fork?.parentThreadId !== thread.id || child.fork.parentMessageId !== message.id) throw new Error('分叉响应身份不匹配。')
          forkRetry = undefined
          if (draft.value.trim() === body) draft.value = ''
          onFork(child)
        } catch (error) { if (alive && version === lifetime) notice.textContent = String(error) }
        finally {
          if (version === lifetime) { forking = false; if (alive) { send.disabled = Boolean(requestId); render() } }
        }
      })
      const translation = proseTranslationView(message.body, async (input, signal) => {
        signal.throwIfAborted()
        const result = proseTranslationResultSchema.parse(await invoke('anchored-comments.prose.translate', input))
        signal.throwIfAborted()
        return result
      })
      translations.push(translation)
      article.append(author, translation.root, fork); history.append(article)
    }
    history.scrollTop = scrollTop
  }
  const stop = async () => {
    if (!requestId) return
    try { await invoke('anchored-comments.conversation.cancel', { threadId: thread.id, requestId }) }
    catch (error) { if (alive) notice.textContent = String(error) }
  }
  cancel.addEventListener('click', () => void stop())
  send.addEventListener('click', async () => {
    if (!alive || requestId || forking || !draft.value.trim()) return
    if (forkRetry) { notice.textContent = '上次分叉结果未知，请先重试原分叉或关闭后刷新核对。'; return }
    const body = draft.value.trim()
    if (retry && retry.body !== body) {
      notice.textContent = '上次回复结果未知。请恢复原问题并重试，或关闭后刷新讨论核对。'
      return
    }
    const id = retry?.requestId ?? crypto.randomUUID()
    const version = lifetime
    retry = { requestId: id, body }
    requestId = id; send.disabled = true; cancel.disabled = false; notice.textContent = '正在回复…'; render()
    try {
      const result = anchoredCommentReplyResultSchema.parse(await invoke('anchored-comments.conversation.reply', {
        threadId: thread.id, requestId: id, body
      }))
      if (!alive || version !== lifetime || requestId !== id) return
      if (result.thread.id !== thread.id) throw new Error('回复响应身份不匹配。')
      retry = undefined
      thread = result.thread
      onChange(thread)
      if (thread.messages.some((message) => message.id === `${id}:user`) && draft.value.trim() === body) draft.value = ''
      notice.textContent = result.error ?? (result.state === 'cancelled' ? '回复已停止，问题已保留。' : result.truncated ? '回复已保存；上下文按固定上限截断。' : '回复已保存。')
    } catch (error) { if (alive && version === lifetime) notice.textContent = String(error) }
    finally {
      if (alive && version === lifetime && requestId === id) { requestId = undefined; send.disabled = false; cancel.disabled = true; render() }
    }
  })
  const hide = () => { if (!alive) return; hiddenScrollTop = history.scrollTop; void stop(); clearTranslations(); alive = false; lifetime++; requestId = undefined; forking = false; root.remove(); onClose() }
  const dispose = (cancelRequest = true) => { if (disposed) return; if (cancelRequest && alive) void stop(); clearTranslations(); disposed = true; alive = false; lifetime++; root.remove() }
  const reopen = (container: HTMLElement) => {
    if (disposed) return
    const scrollTop = alive ? history.scrollTop : hiddenScrollTop
    alive = true; send.disabled = Boolean(requestId) || forking; cancel.disabled = !requestId
    if (!translations.length) render()
    container.append(root)
    history.scrollTop = scrollTop
  }
  close.addEventListener('click', hide)
  root.append(header, navigation, code, history, draft, send, cancel, notice)
  setChildren([])
  render()
  const update = (next: AnchoredCommentThread) => {
    if (disposed || next.id !== thread.id || requestId || forking) return
    const scrollTop = alive ? history.scrollTop : hiddenScrollTop
    thread = next
    title.textContent = (thread.fork ? '分叉讨论' : '代码讨论') + (thread.anchorResolution === 'needs_retargeting' ? ' · 定位已过期' : '')
    render(); history.scrollTop = scrollTop
  }
  return { root, dispose, reopen, setChildren, update }
}
