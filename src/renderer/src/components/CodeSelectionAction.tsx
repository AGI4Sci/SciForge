import { useContext, useRef, useState } from 'react'
import { CodeSelectionScope } from './code-selection-scope'
import type { CodeSelectionSnapshot } from '@sciforge/domain-sdk/renderer'
import { domainRendererNavigationHost } from '../domain-modules/domain-renderer-navigation'
import { createCodeSelection, openCodeSelection, type CodeRow } from '../lib/code-selection'

/** Scope is read from the owning session; a file from another workspace cannot be relabeled. */
export function CodeSelectionAction({ filePath, workspaceRoot, sessionId, read }: {
  filePath: string; workspaceRoot?: string; sessionId?: string
  read: () => { text: string; start: number; end: number; bounds: DOMRect; row?: CodeRow } | null
}) {
  const owner = useContext(CodeSelectionScope)
  sessionId ??= owner.sessionId
  workspaceRoot ??= owner.workspaceRoot
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const fence = useRef(0)
  const scopeKey = JSON.stringify([filePath, workspaceRoot, sessionId])
  const currentKey = useRef(scopeKey); currentKey.current = scopeKey
  const open = async () => {
    const selected = read()
    if (!selected || busy) { setNotice('请先选择代码。'); return }
    const { useChatStore } = await import('../store/chat-store')
    const state = useChatStore.getState()
    const thread = state.threads.find(thread => thread.id === (sessionId ?? state.activeThreadId))
    if (!thread?.runtimeId || !thread.workspace || (workspaceRoot && workspaceRoot !== thread.workspace)) { setNotice('来源工作区与当前会话不匹配。'); return }
    const version = ++fence.current, key = currentKey.current
    setBusy(true)
    try {
      const rect = selected.bounds
      const bounds = { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
      const value = await createCodeSelection({ filePath, text: selected.text, start: selected.start, end: selected.end,
        scope: { workspaceRoot: thread.workspace, threadId: thread.id, runtimeId: thread.runtimeId }, bounds,
        viewport: { width: innerWidth, height: innerHeight, scaleFactor: devicePixelRatio },
        ...(selected.row ? { side: selected.row.side, firstLine: selected.row.line, hunkHeader: selected.row.hunkHeader } : {}) })
      if (key !== currentKey.current || version !== fence.current) return
      await openCodeSelection(value as CodeSelectionSnapshot, domainRendererNavigationHost.workbench)
      setNotice('已打开代码讨论草稿。')
    } catch (error) { if (key === currentKey.current) setNotice(String(error)) }
    finally { if (version === fence.current) setBusy(false) }
  }
  return <span className="flex items-center gap-2 text-ds-xs"><button type="button" disabled={busy} onMouseDown={event => event.preventDefault()} onClick={() => void open()} className="rounded border border-ds-border px-2 py-1">讨论所选代码</button>{notice && <span role="status">{notice}</span>}</span>
}
