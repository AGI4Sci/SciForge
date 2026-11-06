import { domainRendererSelectionSnapshotSchema, domainWorkbenchOpenResourceInputSchema } from '@sciforge/domain-sdk/renderer'
import { anchoredCommentUpsertInputSchema } from './core/contract.js'

export type SelectionHostScope = { workspaceRoot: string; sessionId: string; runtimeId: string }

export function boundSelection(value: unknown, host: SelectionHostScope) {
  const selection = domainRendererSelectionSnapshotSchema.parse(value)
  if (!host.workspaceRoot || selection.scope.workspaceRoot !== host.workspaceRoot) throw new Error('选区不属于当前面板绑定的工作区。请返回来源工作区。')
  if (!host.runtimeId || !host.sessionId || selection.scope.runtimeId !== host.runtimeId || selection.scope.threadId !== host.sessionId) throw new Error('宿主会话身份缺失或选区会话不匹配；不能保存到其他会话。')
  return selection
}

export function selectionFromResource(resource: unknown, host: SelectionHostScope) {
  const parsed = domainWorkbenchOpenResourceInputSchema.parse({ sessionId: host.sessionId, resource }).resource
  const selection = boundSelection(parsed.context, host)
  if (parsed.resourceKind !== selection.kind || parsed.resourceId !== selection.resourceId) throw new Error('资源身份与选区不匹配。')
  return selection
}

/** Data receiver only. The Host still authorizes every write to its bound workspace. */
export function selectionCommentInput(value: unknown, body: string, host: SelectionHostScope, id: string, now: string) {
  const selection = boundSelection(value, host)
  const workspaceRoot = host.workspaceRoot
  const targetKey = JSON.stringify([selection.resourceKind, selection.scope.runtimeId, selection.scope.threadId, selection.resourceId])
  return anchoredCommentUpsertInputSchema.parse({ thread: {
    schemaVersion: 1, id, workspaceKey: workspaceRoot, purpose: 'research',
    anchor: { targetKey, targetLabel: selection.label, bounds: selection.bounds,
      canonical: { kind: 'research', resourceKind: selection.resourceKind, resourceId: selection.resourceId,
        contentDigest: selection.revision,
        selection: { quote: selection.quote, runtimeId: selection.scope.runtimeId, threadId: selection.scope.threadId,
          ...(selection.source ? { sourceRuntimeId: selection.source.runtimeId, sourceThreadId: selection.source.threadId, turnId: selection.source.turnId, itemId: selection.source.itemId } : {}) } } },
    capture: { capturedAt: selection.capturedAt, appVersion: 'unknown', platform: 'unknown',
      viewport: selection.viewport, targetLabel: selection.label, targetBounds: selection.bounds,
      contentDigest: selection.revision, unavailableReason: '仅保存文字选区快照；未请求截图，未验证当前来源是否变化。' },
    messages: [{ id: id + '-message', authorKind: 'user', body, createdAt: now, updatedAt: now }],
    status: 'open', anchorResolution: 'needs_retargeting', feedback: { state: 'local' }, createdAt: now, updatedAt: now
  } })
}
