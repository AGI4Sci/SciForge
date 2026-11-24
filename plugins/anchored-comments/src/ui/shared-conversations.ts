import { CURRENT_PROTOCOL_VERSION, codeConversationCommandByteLength, MAX_CODE_CONVERSATION_COMMAND_BYTES, type CodeConversation } from '@sciforge/collaboration-contracts'
import { sharedPublicationOf } from '../core/main/shared-publication.js'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS as actions, sharedConversationProjectInputSchema,
  sharedConversationProjectsResultSchema, sharedConversationPublishInputSchema, sharedConversationResultSchema, sharedConversationSubmitInputSchema,
  sharedConversationDiscardInputSchema,
  type AnchoredCommentThread
} from '../core/contract'

export type SharedConversationsOptions = {
  invoke: (actionId: string, input: unknown) => Promise<unknown>
  listLocalThreads: () => readonly AnchoredCommentThread[]
}

const make = <T extends keyof HTMLElementTagNameMap>(tag: T, text?: string) => {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  return node
}
const identity = () => crypto.randomUUID().replaceAll('-', '')
type Write = { action: string; input: unknown; fingerprint: string }

/** Host owns confirmation for external-write capabilities. No transport or identity state lives here. */
export function sharedConversationsPanel({ invoke, listLocalThreads }: SharedConversationsOptions) {
  let projectId = '', epoch = 0, alive = true, busy = false
  let conversations: CodeConversation[] = []
  let nextCursor: string | undefined, discovering = false
  const uncertain = new Map<string, Write>()
  const root = make('section'); root.className = 'shared-conversations'; root.setAttribute('aria-label', '共享代码讨论')
  const project = make('select'); project.setAttribute('aria-label', 'Project')
  const placeholder = make('option', '选择 Project'); placeholder.value = ''; project.append(placeholder)
  const discover = make('button', '读取 Projects'), more = make('button', '加载更多 Projects'); more.hidden = true
  const choose = make('button', '选择 Project')
  const refresh = make('button', '刷新共享讨论')
  const pending = make('p')
  const rejected = make('section'); rejected.setAttribute('aria-label', '已拒绝的共享写入')
  const retryApproval = make('input'); retryApproval.type = 'checkbox'
  const retryLabel = make('label', '确认向当前 Project 重试待发送写入'); retryLabel.append(retryApproval)
  const retry = make('button', '重试待发送写入')
  const retryUnknown = make('button', '重试原操作')
  const local = make('section'); local.setAttribute('aria-label', '发布本地消息')
  const shared = make('section'); shared.setAttribute('aria-label', '共享讨论列表')
  const notice = make('p'); notice.setAttribute('role', 'status')
  root.append(make('h2', '共享代码讨论'), make('p', '选择你有权限访问的 Project。刷新只读取；发布、回复和重试会提交共享写入。'),
    discover, project, more, choose, refresh, pending, rejected, retryLabel, retry, retryUnknown, notice, local, shared)

  const controls = () => {
    refresh.disabled = busy || !projectId
    retry.disabled = busy || !projectId || !retryApproval.checked
    retryUnknown.disabled = busy || !uncertain.has(projectId)
    discover.disabled = discovering
    more.disabled = discovering
    for (const button of local.querySelectorAll('button')) button.disabled = busy || uncertain.has(projectId)
    for (const button of shared.querySelectorAll('button')) button.disabled = busy || uncertain.has(projectId)
    for (const button of rejected.querySelectorAll('button')) button.disabled = busy
  }
  const request = async (action: string, input: unknown, write?: Write) => {
    if (!alive || busy || !projectId) return
    const version = epoch, target = projectId
    busy = true
    if (write) uncertain.set(target, write)
    notice.textContent = '正在处理…'; controls()
    try {
      const raw = await invoke(action, input)
      if (!alive || epoch !== version) return
      const result = sharedConversationResultSchema.parse(raw)
      if (result.projectId !== target || result.conversations.some(item => item.projectId !== target)) throw new Error('共享响应 Project 身份不匹配。')
      const unknown = uncertain.get(target)?.input as { idempotencyKey?: string; command?: { idempotencyKey?: string } } | undefined
      const unknownKey = unknown?.command?.idempotencyKey ?? unknown?.idempotencyKey
      if (unknownKey && (result.outcomeReceipts.some(item => item.idempotencyKey === unknownKey) ||
          result.rejectedCommands.some(item => item.idempotencyKey === unknownKey))) uncertain.delete(target)
      conversations = result.conversations
      pending.textContent = `待发送写入：${result.pendingCount} · 已读取序号：${result.afterSequence}`
      rejected.replaceChildren()
      for (const item of result.rejectedCommands) {
        const row = make('div'), discard = make('button', '丢弃已拒绝写入')
        row.append(make('p', `写入已被拒绝 · ${item.conversationId} · ${item.code} (${item.status})：${item.message}`), discard)
        discard.addEventListener('click', () => void request(actions.sharedDiscard,
          sharedConversationDiscardInputSchema.parse({ projectId: target, idempotencyKey: item.idempotencyKey })))
        rejected.append(row)
      }
      notice.textContent = result.rejectedCommands.length ? '服务器已明确拒绝写入。可丢弃该操作，再根据最新讨论重新提交。' :
        result.pendingCount ? '操作已保存在待发送队列。检查错误后，明确确认并重试待发送写入。' : '共享讨论已更新。'
      renderShared()
    } catch (error) {
      if (alive && epoch === version) notice.textContent = `${error instanceof Error ? error.message : String(error)}${write ? ' 操作结果未知；可重试原操作，身份和内容保持不变。' : ''}`
    } finally {
      if (alive && epoch === version) { busy = false; controls() }
    }
  }
  const submit = (fields: Record<string, unknown>) => {
    if (!alive || busy || !projectId) return
    if (uncertain.has(projectId)) { notice.textContent = '上次写入结果未知，请先重试原操作。'; return }
    try {
      const input = sharedConversationSubmitInputSchema.parse({ projectId, command: {
        protocolVersion: CURRENT_PROTOCOL_VERSION, projectId, requestId: `req_${identity()}`,
        idempotencyKey: `idem_${identity()}`, ...fields
      } })
      if (codeConversationCommandByteLength(input.command) > MAX_CODE_CONVERSATION_COMMAND_BYTES) throw new Error('共享写入过大，请缩短内容。')
      void request(actions.sharedSubmit, input, { action: actions.sharedSubmit, input, fingerprint: JSON.stringify(input) })
    } catch (error) { notice.textContent = `无法提交：${String(error)}` }
  }
  const renderShared = () => {
    shared.replaceChildren()
    if (!conversations.length) shared.append(make('p', '当前没有已读取的共享讨论。'))
    for (const conversation of conversations) {
      const article = make('article')
      article.append(make('h3', `${conversation.anchor.filePath}:${conversation.anchor.line} · ${conversation.status}`),
        make('pre', conversation.anchor.code))
      if (conversation.fork) {
        const inherited = make('details'), fork = conversation.fork
        inherited.append(make('summary', `冻结的父讨论上下文 · ${fork.parentConversationId} · ${fork.parentMessageId}${fork.truncated ? ' · 已截断' : ''}`))
        for (const message of fork.messages) inherited.append(make('p', `${message.kind}: ${message.body}`))
        article.append(inherited)
      }
      const draft = make('textarea'); draft.setAttribute('aria-label', `共享回复 ${conversation.conversationId}`)
      draft.maxLength = 20_000
      for (const message of conversation.messages) {
        const row = make('div')
        row.append(make('small', `${message.kind} · ${message.publishedByUserId}`), make('p', message.body))
        const fork = make('button', '从此消息分叉')
        fork.addEventListener('click', () => {
          if (!draft.value.trim()) { notice.textContent = '先填写分叉问题。'; draft.focus(); return }
          submit({ type: 'project.code_conversation.fork', conversationId: identity(),
            parentConversationId: conversation.conversationId, parentMessageId: message.messageId,
            message: { messageId: identity(), kind: 'user', body: draft.value.trim() } })
        })
        row.append(fork); article.append(row)
      }
      const reply = make('button', '发送共享回复')
      reply.addEventListener('click', () => {
        if (!draft.value.trim()) { notice.textContent = '先填写共享回复。'; draft.focus(); return }
        submit({ type: 'project.code_conversation.append', conversationId: conversation.conversationId,
          message: { messageId: identity(), kind: 'user', body: draft.value.trim() } })
      })
      const status = make('button', conversation.status === 'open' ? '解决共享讨论' : '重新打开共享讨论')
      status.addEventListener('click', () => submit({ type: 'project.code_conversation.set_status',
        conversationId: conversation.conversationId, status: conversation.status === 'open' ? 'resolved' : 'open',
        expectedRevision: conversation.revision, observedMessageId: conversation.messages.at(-1)!.messageId }))
      article.append(draft, reply, status); shared.append(article)
    }
    controls()
  }
  const renderLocal = () => {
    local.replaceChildren()
    if (!projectId) return
    for (const thread of listLocalThreads().filter(item => item.purpose === 'research' && item.anchor.codeAnchor)) {
      const article = make('article'), anchor = thread.anchor.codeAnchor!
      article.append(make('h3', thread.anchor.targetLabel), make('p', '发布将向 Project 成员披露下列代码、相对文件位置、修订和明确勾选的消息。'),
        make('pre', `${anchor.filePath}:${anchor.line}${anchor.endLine ? `–${anchor.endLine}` : ''}\n${anchor.code}\n修订：${anchor.baseRevision}\n摘要：${anchor.contentDigest}`))
      const choices = thread.messages.filter(message => message.authorKind !== 'system').map(message => {
        const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.value = message.id
        const label = make('label', `${message.authorKind}: ${message.body}`); label.append(checkbox); article.append(label)
        return { checkbox, message }
      })
      const approval = make('input'); approval.type = 'checkbox'
      const disclosure = make('label', '确认披露以上代码及勾选的消息'); disclosure.append(approval)
      const publish = make('button', '发布所选消息')
      publish.addEventListener('click', () => {
        if (!alive || busy || uncertain.has(projectId)) return
        const selected = choices.filter(choice => choice.checkbox.checked).map(choice => choice.message)
        if (!approval.checked || !selected.length) { notice.textContent = '请勾选要发布的消息，并确认代码披露。'; return }
        // If local content changed since disclosure, rebuild the chooser before authorizing anything.
        const latest = listLocalThreads().find(item => item.id === thread.id)
        if (!latest || JSON.stringify(latest.anchor.codeAnchor) !== JSON.stringify(anchor) || selected.some(message =>
          JSON.stringify(latest.messages.find(item => item.id === message.id)) !== JSON.stringify(message))) {
          notice.textContent = '本地消息或代码已变化，请重新核对并选择。'; renderLocal(); controls(); return
        }
        try {
          const input = sharedConversationPublishInputSchema.parse({ projectId, threadId: thread.id,
            requestId: `req_${identity()}`, idempotencyKey: `idem_${identity()}`, messageIds: selected.map(message => message.id) })
          const fingerprint = JSON.stringify({ anchor, messages: selected })
          if (codeConversationCommandByteLength(sharedPublicationOf(thread, input)) > MAX_CODE_CONVERSATION_COMMAND_BYTES) {
            throw new Error('共享写入过大，请减少所选消息或缩短内容。')
          }
          void request(actions.sharedPublish, input, { action: actions.sharedPublish, input, fingerprint })
        } catch (error) { notice.textContent = `无法发布：${String(error)}` }
      })
      article.append(disclosure, publish); local.append(article)
    }
  }
  const setProject = (value: string) => {
    if (!alive) return
    try {
      const next = sharedConversationProjectInputSchema.parse({ projectId: value.trim() }).projectId
      if (next === projectId) return
      epoch++; busy = false; discovering = false; projectId = next; project.value = next; conversations = []
      rejected.replaceChildren()
      retryApproval.checked = false; pending.textContent = ''; notice.textContent = 'Project 已选择；点击刷新读取共享讨论。'
      renderLocal(); renderShared(); controls()
    } catch { notice.textContent = 'Project ID 格式无效，请输入完整的 prj_… 标识。' }
  }
  const discoverProjects = async (cursor?: string) => {
    if (!alive || discovering) return
    const version = epoch; discovering = true; controls()
    try {
      const raw = await invoke(actions.sharedProjects, cursor ? { cursor } : {})
      if (!alive || version !== epoch) return
      const result = sharedConversationProjectsResultSchema.parse(raw)
      if (result.cursor !== cursor) throw new Error('Project 列表响应游标不匹配。')
      if (!cursor) project.replaceChildren(placeholder)
      for (const item of result.projects) {
        if ([...project.options].some(option => option.value === item.projectId)) continue
        const option = make('option', item.displayName); option.value = item.projectId; project.append(option)
      }
      project.value = projectId
      nextCursor = result.nextCursor; more.hidden = !nextCursor
      notice.textContent = result.projects.length ? '请选择 Project。' : '没有可访问的 Project。请检查登录和成员权限。'
    } catch (error) { if (alive && version === epoch) notice.textContent = `读取 Projects 失败：${String(error)}` }
    finally { if (alive && version === epoch) { discovering = false; controls() } }
  }
  discover.addEventListener('click', () => void discoverProjects())
  more.addEventListener('click', () => { if (nextCursor) void discoverProjects(nextCursor) })
  choose.addEventListener('click', () => setProject(project.value))
  refresh.addEventListener('click', () => void request(actions.sharedPull, { projectId }))
  retryApproval.addEventListener('change', controls)
  retry.addEventListener('click', () => {
    if (!retryApproval.checked) return
    retryApproval.checked = false
    void request(actions.sharedRetry, { projectId })
  })
  retryUnknown.addEventListener('click', () => {
    const write = uncertain.get(projectId)
    if (!write) return
    if (write.action === actions.sharedPublish) {
      const input = write.input as { threadId: string; messageIds: string[] }
      const thread = listLocalThreads().find(item => item.id === input.threadId)
      const fingerprint = thread && JSON.stringify({ anchor: thread.anchor.codeAnchor,
        messages: thread.messages.filter(message => input.messageIds.includes(message.id)) })
      if (fingerprint !== write.fingerprint) { notice.textContent = '原发布内容已变化，不能复用操作身份。请刷新核对或确认重试已排队的写入。'; return }
    }
    void request(write.action, write.input, write)
  })
  const resetScope = () => {
    epoch++; busy = false; discovering = false; projectId = ''; conversations = []; uncertain.clear()
    nextCursor = undefined; more.hidden = true; project.replaceChildren(placeholder)
    project.value = ''; retryApproval.checked = false; pending.textContent = ''; notice.textContent = ''
    local.replaceChildren(); shared.replaceChildren(); rejected.replaceChildren(); controls()
  }
  controls()
  return { root, setProject, resetScope, refreshLocalThreads: () => { if (alive) { renderLocal(); controls() } },
    dispose: () => { if (!alive) return; resetScope(); alive = false; root.remove() } }
}
