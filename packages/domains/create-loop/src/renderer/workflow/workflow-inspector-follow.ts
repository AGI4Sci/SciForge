import type { WorkflowNodeRunResultV1 } from '../../contract.js'

export type WorkflowInspectorPanelMode = 'config' | 'node' | 'run'

export function panelModeAfterManualNodeSelection(
  current: WorkflowInspectorPanelMode
): WorkflowInspectorPanelMode {
  return current === 'node' ? 'node' : 'config'
}

export type WorkflowInspectorFollowResult = Readonly<{
  cursor: string
  nodeId: string | null
}>

export function nextCompletedWorkflowNode(
  results: Readonly<Record<string, WorkflowNodeRunResultV1>>,
  previousCursor: string
): WorkflowInspectorFollowResult {
  const completed = Object.values(results)
    .filter((result) => Number.isFinite(Date.parse(result.finishedAt)))
    .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))[0]

  if (!completed) return { cursor: previousCursor, nodeId: null }
  const cursor = `${completed.nodeId}:${completed.finishedAt}`
  return {
    cursor,
    nodeId: cursor === previousCursor ? null : completed.nodeId
  }
}
