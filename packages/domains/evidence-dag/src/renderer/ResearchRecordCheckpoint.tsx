import React, { useState, type ReactElement } from 'react'
import type { DomainRendererCapabilityInvoker, DomainRendererWorkbenchHost } from '@sciforge/domain-sdk/host'
import { createResearchCheckpointsRendererClient, openCommittedResearchCheckpoint } from '@sciforge/domain-research-checkpoints/renderer'
import { researchRecordContracts, type ResearchRecordNode, type ResearchRecordScope } from '../research-record-contract'

export async function resolveRecordCheckpointNode(node: ResearchRecordNode, scope: ResearchRecordScope, invoker: DomainRendererCapabilityInvoker): Promise<ResearchRecordNode> {
  if (node.kind !== 'phase') return node
  if (!node.recentRound) throw new Error('该阶段暂无精确轮次引用。')
  const view = await invoker.invoke(researchRecordContracts.view, { ...scope, nodeId: node.recentRound.id, offset: 0 }, { workspaceId: scope.workspaceRoot })
  if (!view.node || view.node.id !== node.recentRound.id || view.node.kind !== 'round') throw new Error('阶段关联轮次当前不可用。')
  return view.node
}

export async function openResearchRecordCheckpoint(node: ResearchRecordNode, scope: ResearchRecordScope, invoker: DomainRendererCapabilityInvoker, workbench?: DomainRendererWorkbenchHost): Promise<void> {
  const round = await resolveRecordCheckpointNode(node, scope, invoker)
  const source = round.source ?? round.scope
  const turnId = round.source?.turnId ?? round.turnId
  if (!source || !turnId) throw new Error('未保存精确轮次引用；档案状态未知。')
  if (source.workspaceRoot !== scope.workspaceRoot) throw new Error('来源属于其他工作区；请在来源工作区查看档案。')
  const result = await createResearchCheckpointsRendererClient(invoker).readTurnStatus(source.workspaceRoot, {
    runtimeId: source.runtimeId, threadId: source.threadId, turnId
  })
  if (!result.ok) throw new Error(result.issue.message)
  const status = result.value
  if (status.runtimeId !== source.runtimeId || status.threadId !== source.threadId || status.turnId !== turnId) throw new Error('档案返回的轮次身份不匹配。')
  if (status.state !== 'committed') {
    const labels = { unrecorded: '此轮尚无科研档案。', pending: '此轮档案正在记录。', failed: '此轮档案记录失败。', 'stale-conflict': '此轮档案存在版本冲突。' }
    throw new Error(labels[status.state] + ('error' in status ? ` ${status.error}` : ''))
  }
  if (workbench?.openSession && !await workbench.openSession({ ...scope, focusComposer: false, readOnly: true })) throw new Error('档案所属会话当前不可用；原阶段记录仍保留。')
  if (!openCommittedResearchCheckpoint({ workbench }, scope.threadId, status)) throw new Error('当前工作台无法打开精确档案。')
}

export function ResearchRecordCheckpoint({ node, scope, invoker, workbench }: {
  node: ResearchRecordNode; scope: ResearchRecordScope; invoker: DomainRendererCapabilityInvoker; workbench?: DomainRendererWorkbenchHost
}): ReactElement {
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const open = async () => {
    setBusy(true); setIssue('')
    try { await openResearchRecordCheckpoint(node, scope, invoker, workbench) }
    catch (error) { setIssue(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const available = Boolean(workbench?.openResource && workbench.canOpenResource?.('artifact-version'))
  return <div className="my-2 record-caption text-ds-muted">
    <button className="rounded border border-ds-border px-2 py-1 hover:bg-ds-hover disabled:opacity-50" disabled={busy || !available || (node.kind === 'phase' && !node.recentRound)} onClick={() => void open()}>{busy ? '正在读取精确档案…' : node.kind === 'phase' ? '最近轮次档案' : '打开本轮档案'}</button>
    {!available && <span className="ml-2">档案入口不可用</span>}
    {node.kind === 'phase' && !node.recentRound && <span className="ml-2">暂无精确轮次引用</span>}
    {issue && <p role="status" className="mt-1">{issue}</p>}
  </div>
}
