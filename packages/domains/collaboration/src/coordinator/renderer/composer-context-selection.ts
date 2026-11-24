import type { ProjectCoordinatorProject, ProjectCoordinatorSessionBinding } from '../contract.js'

type TaskView = ProjectCoordinatorProject['tasks'][number]
const terminal = new Set(['completed', 'failed', 'cancelled'])
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const coverage = (total: number, included: number) => ({ total, included, omitted: total - included })

/** Rank only existing structural facts; never infer scientific success or failure from prose. */
export function selectComposerContextFacts(
  project: ProjectCoordinatorProject,
  worker?: Extract<ProjectCoordinatorSessionBinding, { role: 'worker' }>
) {
  const manifests = new Map((project.deliveryDrive?.taskDeliveries ?? []).map((m) => [m.deliveryManifestId, m]))
  const execution = worker && project.tasks.find((v) => v.task.taskId === worker.taskId)
    ?.executions.find((e) => e.executionId === worker.executionId)
  const questions = project.pendingHumanNeeded.filter((q) => !worker || (
    q.context.scope === 'worker_execution' && q.context.taskId === worker.taskId &&
    q.context.executionId === worker.executionId
  )).slice().sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') ||
    compare(b.updatedAt, a.updatedAt) || compare(a.humanRequestId, b.humanRequestId))
  const humanTaskIds = new Set(questions.flatMap((q) => q.status === 'pending' &&
    q.context.scope === 'worker_execution' ? [q.context.taskId] : []))
  const byId = new Map(project.tasks.map((v) => [v.task.taskId, v]))
  const relevant = new Set<string>(humanTaskIds)
  for (const { task } of project.tasks) if (!terminal.has(task.status)) relevant.add(task.taskId)
  // Iterative closure handles deep graphs and cycles without recursive stack growth.
  const queue = [...relevant]
  for (let i = 0; i < queue.length; i += 1) {
    for (const id of byId.get(queue[i]!)?.task.dependencyTaskIds ?? []) {
      if (!relevant.has(id)) { relevant.add(id); queue.push(id) }
    }
  }
  const rank = ({ task }: TaskView) => humanTaskIds.has(task.taskId) ? 0 :
    !terminal.has(task.status) ? 1 : relevant.has(task.taskId) ? 2 : 3
  const tasks = project.tasks.filter((v) => !worker || v.task.taskId === worker.taskId)
    .slice().sort((a, b) => rank(a) - rank(b) || compare(b.task.updatedAt, a.task.updatedAt) ||
      compare(a.task.taskId, b.task.taskId))
  const selectedTasks = tasks.slice(0, worker ? 1 : 12)
  const selectedIds = new Set(selectedTasks.map((v) => v.task.taskId))
  const results = (project.deliveryDrive?.projectResults ?? []).filter((r) => {
    const m = manifests.get(r.deliveryManifestId)
    return !worker || (m?.taskId === worker.taskId && m.executionId === worker.executionId)
  }).slice().sort((a, b) => {
    const pertinent = (id: string) => Number(selectedIds.has(manifests.get(id)?.taskId ?? ''))
    return pertinent(b.deliveryManifestId) - pertinent(a.deliveryManifestId) ||
      compare(b.adoptedAt, a.adoptedAt) || b.projectVersion - a.projectVersion ||
      compare(a.projectResultId, b.projectResultId)
  })
  // Records have no executionId. Only an explicit current submission reference can
  // associate one with this execution; task-only records must not cross attempts.
  const records = project.records.filter((r) => !worker || (r.sourceTaskId === worker.taskId &&
    execution?.currentResultSubmissionId != null && r.sourceResultSubmissionId === execution.currentResultSubmissionId))
    .slice().sort((a, b) => Number(selectedIds.has(b.sourceTaskId ?? '')) - Number(selectedIds.has(a.sourceTaskId ?? '')) ||
      compare(b.updatedAt, a.updatedAt) || compare(a.projectRecordId, b.projectRecordId))
  return {
    tasks: selectedTasks, results: results.slice(0, 8), records: records.slice(0, 8), questions: questions.slice(0, 8),
    coverage: {
      scope: worker ? 'exact-worker-execution' : 'project',
      tasks: coverage(tasks.length, selectedTasks.length),
      evidenceAndReview: coverage(results.length, Math.min(8, results.length)),
      [worker ? 'associatedRecords' : 'acceptedDecisionsAndRecords']: coverage(records.length, Math.min(8, records.length)),
      pendingHumanNeeded: coverage(questions.length, Math.min(8, questions.length))
    }
  }
}

const textLimits: Readonly<Record<string, number>> = {
  title: 240, displayName: 240, goal: 1500, objective: 1500,
  body: 800, prompt: 800, safeSummary: 800, completionCriteria: 800
}

/** Keep exact references intact, report field/list clipping, then shed lowest ranked
 * section tails until the serialized budget fits. Native history remains canonical. */
export function renderBoundedComposerContext(input: object, maxChars: number): string {
  const clippedFields: string[] = []
  const clippedLists: Record<string, ReturnType<typeof coverage>> = {}
  function bounded(value: unknown, path: string, key: string): unknown {
    // Only package-owned summary fields may be shortened. Nested context and
    // opaque references (including access policies) must retain their identity.
    const summaryField = /^(?:project|task|tasks\[\d+\]|acceptedDecisionsAndRecords\[\d+\]|associatedRecords\[\d+\]|pendingHumanNeeded\[\d+\](?:\.confirmableAction)?)\.[^.[]+$/.test(path) ||
      /^task\.completionCriteria\[\d+\]$/.test(path)
    if (summaryField && typeof value === 'string' && textLimits[key] && value.length > textLimits[key]!) {
      clippedFields.push(path)
      return `${value.slice(0, textLimits[key]! - 1)}…`
    }
    if (Array.isArray(value)) {
      // Bound only known summary collections. Never truncate an opaque reference
      // array into a different, apparently exact reference or permission policy.
      const summaryList = /^(?:tasks|evidenceAndReview|acceptedDecisionsAndRecords|associatedRecords|pendingHumanNeeded|tasks\[\d+\]\.(?:executions|dependencyTaskIds)|task\.completionCriteria)$/.test(path)
      if (!summaryList) return value
      const limit = path === 'tasks' ? 12 : 8
      if (value.length > limit) clippedLists[path] = coverage(value.length, limit)
      return value.slice(0, limit).map((v, i) => bounded(v, `${path}[${i}]`, key))
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([k, v]) => [k, bounded(v, path ? `${path}.${k}` : k, k)]))
    return value
  }
  const snapshot = bounded(input, '', '') as Record<string, unknown>
  const counts = snapshot.coverage as Record<string, unknown>
  const sections = ['tasks', 'evidenceAndReview', 'acceptedDecisionsAndRecords', 'associatedRecords', 'pendingHumanNeeded']
  let budgetReduced = false
  const serialize = () => JSON.stringify({ ...snapshot, contextCoverage: {
    state: 'bounded-snapshot', budgetReduced, clippedFields, clippedLists,
    notice: 'Totals cover the supplied read snapshot and permitted scope only. Selection and clipping are descriptive, not complete history. Use canonical public reads and native history for omitted details.'
  } }, null, 2)
  let content = serialize()
  while (content.length > maxChars) {
    const candidates = sections.filter((key) => Array.isArray(snapshot[key]) && (snapshot[key] as unknown[]).length)
    const largest = candidates.slice().sort((a, b) => JSON.stringify(snapshot[b]).length - JSON.stringify(snapshot[a]).length)[0]
    if (!largest) {
      // Unusually large exact scalar references cannot be shortened into fake IDs.
      return JSON.stringify({ schemaVersion: 1, state: 'unavailable',
        description: 'Project context exceeds the bounded snapshot budget even after detail omission.',
        authorityNotice: snapshot.authorityNotice,
        coverage: counts, budgetReduced: true })
    }
    const values = snapshot[largest] as unknown[]
    values.pop()
    const count = counts[largest] as ReturnType<typeof coverage>
    counts[largest] = coverage(count.total, values.length)
    budgetReduced = true
    content = serialize()
  }
  return content
}
