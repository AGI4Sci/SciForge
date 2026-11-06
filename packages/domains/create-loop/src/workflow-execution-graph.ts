import type { WorkflowV1 } from './contract.js'

/** Manual runs and nested calls use the same trigger, including disabled triggers. */
export function workflowCallTrigger(workflow: WorkflowV1): WorkflowV1['nodes'][number] | undefined {
  return workflow.nodes.find((node) => node.type === 'manual-trigger') ??
    workflow.nodes.find((node) => node.type.endsWith('-trigger'))
}

/** Disabled nodes pass their input through, so their outgoing edges remain reachable. */
export function workflowReachableNodeIds(workflow: WorkflowV1, triggerNodeId: string): Set<string> {
  const reachable = new Set<string>()
  const queue = [triggerNodeId]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (reachable.has(nodeId)) continue
    reachable.add(nodeId)
    for (const connection of workflow.connections) {
      if (connection.source === nodeId && !reachable.has(connection.target)) {
        queue.push(connection.target)
      }
    }
  }
  return reachable
}
