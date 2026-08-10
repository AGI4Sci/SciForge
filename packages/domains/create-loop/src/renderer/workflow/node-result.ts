import type { WorkflowNodeRunResultV1 } from '../../contract.js'

export function latestNodeResult(
  nodeId: string,
  persisted: WorkflowNodeRunResultV1 | null,
  tested: WorkflowNodeRunResultV1 | null
): WorkflowNodeRunResultV1 | null {
  const matchingTest = tested?.nodeId === nodeId ? tested : null
  if (!persisted) return matchingTest
  if (!matchingTest) return persisted
  return Date.parse(matchingTest.finishedAt) >= Date.parse(persisted.finishedAt)
    ? matchingTest
    : persisted
}
