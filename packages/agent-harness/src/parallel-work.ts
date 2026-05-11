import type {
  CapabilityCostClass,
  CapabilitySideEffectClass,
  LatencyTier,
  ParallelWorkBatch,
  ParallelWorkConflict,
  ParallelWorkExecutionKind,
  ParallelWorkOwner,
  ParallelWorkPlan,
  ParallelWorkResult,
  ParallelWorkTask,
  ParallelWorkTaskTrace,
} from './contracts';

export interface ParallelWorkTaskInput {
  id: string;
  title?: string;
  dependsOn?: string[];
  readSet?: string[];
  writeSet?: string[];
  externalResourceKeys?: string[];
  sideEffectClass?: CapabilitySideEffectClass;
  costClass?: CapabilityCostClass;
  deadlineMs?: number;
  owner: ParallelWorkOwner;
  expectedOutput: string;
  executionKind?: ParallelWorkExecutionKind;
  criticalPath?: boolean;
  valueScore?: number;
}

export interface ParallelWorkPlannerInput {
  planId: string;
  latencyTier?: LatencyTier;
  maxConcurrency?: number;
  firstResultDeadlineMs?: number;
  backgroundAfterMs?: number;
  tasks: ParallelWorkTaskInput[];
}

export interface CreateParallelWorkPlanInput {
  requestId?: string;
  latencyTier: LatencyTier;
  tasks: ParallelWorkTaskInput[];
  maxConcurrency?: number;
  firstResultDeadlineMs?: number;
  backgroundAfterMs?: number;
}

export interface MaterializeParallelWorkResultInput {
  plan: ParallelWorkPlan;
  completedTaskIds?: string[];
  failedTaskIds?: string[];
  cancelledTaskIds?: string[];
  skippedTaskIds?: string[];
  outputRefs?: Record<string, string>;
}

export function createParallelWorkPlan(input: CreateParallelWorkPlanInput): ParallelWorkPlan {
  return planParallelWork({
    planId: stablePlanId(input.requestId, input.latencyTier, input.tasks),
    latencyTier: input.latencyTier,
    maxConcurrency: input.maxConcurrency,
    firstResultDeadlineMs: input.firstResultDeadlineMs,
    backgroundAfterMs: input.backgroundAfterMs,
    tasks: input.tasks,
  });
}

export function planParallelWork(input: ParallelWorkPlannerInput): ParallelWorkPlan {
  const latencyTier = input.latencyTier ?? 'bounded';
  const maxConcurrency = input.maxConcurrency ?? maxConcurrencyForTier(latencyTier);
  const tasks = input.tasks.map((task): ParallelWorkTask => ({
    ...task,
    dependsOn: task.dependsOn ?? [],
    readSet: task.readSet ?? [],
    writeSet: task.writeSet ?? [],
    externalResourceKeys: task.externalResourceKeys ?? [],
    sideEffectClass: task.sideEffectClass ?? 'none',
    costClass: task.costClass ?? 'low',
    deadlineMs: task.deadlineMs ?? input.firstResultDeadlineMs ?? firstResultDeadlineForTier(latencyTier),
    executionKind: task.executionKind ?? (task.criticalPath ? 'critical-path' : 'sidecar'),
    criticalPath: task.criticalPath ?? false,
    valueScore: task.valueScore ?? 0.5,
  }));
  const conflicts = detectParallelWorkConflicts(tasks);
  const serialResources = new Set(conflicts.filter((conflict) => conflict.resolution === 'serialize').flatMap((conflict) => conflict.taskIds));
  const skippedTaskIds = new Set(conflicts.filter((conflict) => conflict.resolution === 'skip').flatMap((conflict) => conflict.taskIds));
  const batches = buildBatches(tasks, maxConcurrency, serialResources, skippedTaskIds, input.firstResultDeadlineMs ?? firstResultDeadlineForTier(latencyTier));
  return {
    schemaVersion: 'sciforge.parallel-work-plan.v1',
    planId: input.planId,
    latencyTier,
    maxConcurrency,
    firstResultDeadlineMs: input.firstResultDeadlineMs ?? firstResultDeadlineForTier(latencyTier),
    backgroundAfterMs: input.backgroundAfterMs ?? backgroundAfterForTier(latencyTier),
    tasks,
    batches,
    conflicts,
    earlyStopPolicy: {
      sidecarValueThreshold: latencyTier === 'quick' ? 0.7 : 0.45,
      cancelSidecarsAfterFirstResult: latencyTier === 'instant' || latencyTier === 'quick' || latencyTier === 'bounded',
      stopReasons: ['first-result-ready', 'deadline-exceeded', 'low-value-sidecar', 'conflict-guard'],
    },
  };
}

export function detectParallelWorkConflicts(tasks: ParallelWorkTask[]): ParallelWorkConflict[] {
  const conflicts: ParallelWorkConflict[] = [];
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex]!;
      const right = tasks[rightIndex]!;
      for (const resource of intersect(left.writeSet, right.writeSet)) {
        conflicts.push({
          kind: 'shared-write',
          taskIds: [left.id, right.id],
          resource,
          resolution: 'serialize',
          reason: 'Tasks claim the same write resource.',
        });
      }
      for (const resource of intersect(left.externalResourceKeys ?? [], right.externalResourceKeys ?? [])) {
        if (left.sideEffectClass !== 'read' || right.sideEffectClass !== 'read') {
          conflicts.push({
            kind: 'external-mutation',
            taskIds: [left.id, right.id],
            resource,
            resolution: 'serialize',
            reason: 'External side effects on the same resource must be serialized.',
          });
        }
      }
    }
  }
  for (const task of tasks) {
    if (task.writeSet.length > 0 && task.owner.readOnly) {
      conflicts.push({
        kind: 'owner-scope-missing',
        taskIds: [task.id],
        resource: task.owner.id,
        resolution: 'skip',
        reason: 'Read-only owner cannot claim write work.',
      });
      continue;
    }
    if (task.writeSet.length > 0 && !writeSetCoveredByOwner(task)) {
      conflicts.push({
        kind: 'owner-scope-missing',
        taskIds: [task.id],
        resource: task.writeSet.join(','),
        resolution: 'skip',
        reason: 'Task writes outside the owner declared scope.',
      });
      continue;
    }
    if ((task.writeSet.length > 0 || task.sideEffectClass !== 'none') && !task.owner.owns.length && !task.owner.readOnly) {
      conflicts.push({
        kind: 'owner-scope-missing',
        taskIds: [task.id],
      resource: task.owner.id,
      resolution: 'skip',
      reason: 'Parallel owner must declare an ownership scope.',
    });
  }
  }
  if (hasDependencyCycle(tasks)) {
    conflicts.push({
      kind: 'dependency-cycle',
      taskIds: tasks.map((task) => task.id),
      resource: 'task-dag',
      resolution: 'defer',
      reason: 'Parallel work DAG contains a cycle.',
    });
  }
  return conflicts;
}

export function materializeParallelWorkResult(
  planOrInput: ParallelWorkPlan | MaterializeParallelWorkResultInput,
  traces: Partial<ParallelWorkTaskTrace>[] = [],
): ParallelWorkResult {
  const plan = 'plan' in planOrInput ? planOrInput.plan : planOrInput;
  const projectedTraces = 'plan' in planOrInput ? tracesFromResultInput(planOrInput) : traces;
  const traceByTask = new Map(traces.map((trace) => [trace.taskId, trace]));
  const inputTraceByTask = new Map(projectedTraces.map((trace) => [trace.taskId, trace]));
  const taskResults = plan.tasks.map((task): ParallelWorkTaskTrace => {
    const trace = inputTraceByTask.get(task.id) ?? traceByTask.get(task.id);
    const batchIndex = plan.batches.find((batch) => batch.taskIds.includes(task.id))?.index;
    return {
      taskId: task.id,
      ownerId: task.owner.id,
      status: trace?.status ?? 'planned',
      batchIndex,
      startedAtMs: trace?.startedAtMs,
      finishedAtMs: trace?.finishedAtMs,
      reason: trace?.reason,
      outputRef: trace?.outputRef,
      mergeDecision: trace?.mergeDecision,
    };
  });
  const firstResultReadyAfterBatch = plan.batches.find((batch) => batch.blocksFirstResult)?.index;
  return {
    schemaVersion: 'sciforge.parallel-work-result.v1',
    planId: plan.planId,
    status: taskResults.some((task) => task.status === 'failed')
      ? 'failed'
      : taskResults.some((task) => task.status === 'cancelled' || task.status === 'skipped' || task.status === 'deferred')
        ? 'partial'
        : 'complete',
    taskResults,
    firstResultReadyAfterBatch,
    cancelledTaskIds: taskResults.filter((task) => task.status === 'cancelled').map((task) => task.taskId),
    skippedTaskIds: taskResults.filter((task) => task.status === 'skipped').map((task) => task.taskId),
    mergeDecisions: taskResults.filter((task) => task.mergeDecision),
  };
}

function buildBatches(
  tasks: ParallelWorkTask[],
  maxConcurrency: number,
  serialTaskIds: Set<string>,
  skippedTaskIds: Set<string>,
  firstResultDeadlineMs: number,
): ParallelWorkBatch[] {
  const batches: ParallelWorkBatch[] = [];
  const completed = new Set<string>();
  const remaining = new Map(tasks.filter((task) => !skippedTaskIds.has(task.id)).map((task) => [task.id, task]));
  let index = 0;
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((task) => (task.dependsOn ?? []).every((dependency) => completed.has(dependency)))
      .sort((left, right) => Number(right.criticalPath) - Number(left.criticalPath) || (right.valueScore ?? 0) - (left.valueScore ?? 0));
    if (!ready.length) break;
    const batchTasks = ready
      .filter((task, taskIndex) => taskIndex === 0 || !serialTaskIds.has(task.id))
      .slice(0, Math.max(1, maxConcurrency));
    batches.push({
      index,
      taskIds: batchTasks.map((task) => task.id),
      blocksFirstResult: batchTasks.some((task) => task.criticalPath),
      deadlineMs: Math.min(...batchTasks.map((task) => task.deadlineMs), firstResultDeadlineMs),
    });
    for (const task of batchTasks) {
      completed.add(task.id);
      remaining.delete(task.id);
    }
    index += 1;
  }
  return batches;
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))].sort();
}

function hasDependencyCycle(tasks: ParallelWorkTask[]): boolean {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of taskById.get(id)?.dependsOn ?? []) {
      if (taskById.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return tasks.some((task) => visit(task.id));
}

function maxConcurrencyForTier(tier: LatencyTier): number {
  return ({ instant: 1, quick: 2, bounded: 4, deep: 6, background: 8 })[tier];
}

function firstResultDeadlineForTier(tier: LatencyTier): number {
  return ({ instant: 3000, quick: 15000, bounded: 30000, deep: 30000, background: 30000 })[tier];
}

function backgroundAfterForTier(tier: LatencyTier): number {
  return ({ instant: 5000, quick: 30000, bounded: 120000, deep: 180000, background: 30000 })[tier];
}

function writeSetCoveredByOwner(task: ParallelWorkTask): boolean {
  if (task.writeSet.length === 0) return true;
  if (task.owner.owns.includes('*')) return true;
  return task.writeSet.every((target) => task.owner.owns.some((scope) => target === scope || target.startsWith(`${scope}/`)));
}

function tracesFromResultInput(input: MaterializeParallelWorkResultInput): Partial<ParallelWorkTaskTrace>[] {
  const completed = new Set(input.completedTaskIds ?? []);
  const failed = new Set(input.failedTaskIds ?? []);
  const cancelled = new Set(input.cancelledTaskIds ?? []);
  const skipped = new Set(input.skippedTaskIds ?? []);
  const scheduled = new Set(input.plan.batches.flatMap((batch) => batch.taskIds));
  return input.plan.tasks.map((task) => {
    const status = failed.has(task.id)
      ? 'failed'
      : cancelled.has(task.id)
        ? 'cancelled'
        : skipped.has(task.id) || !scheduled.has(task.id)
          ? 'skipped'
          : completed.has(task.id) || task.criticalPath
            ? 'succeeded'
            : shouldCancelSidecar(input.plan, task)
              ? 'cancelled'
              : 'deferred';
    return {
      taskId: task.id,
      status,
      reason: status === 'cancelled' ? 'sidecar stopped after first result' : undefined,
      outputRef: input.outputRefs?.[task.id],
      mergeDecision: status === 'succeeded' ? 'merge' : status === 'deferred' ? 'defer' : undefined,
    };
  });
}

function shouldCancelSidecar(plan: ParallelWorkPlan, task: ParallelWorkTask): boolean {
  if (task.criticalPath) return false;
  if (!plan.earlyStopPolicy.cancelSidecarsAfterFirstResult) return false;
  return (task.valueScore ?? 0.5) < plan.earlyStopPolicy.sidecarValueThreshold || task.deadlineMs > plan.firstResultDeadlineMs;
}

function stablePlanId(requestId: string | undefined, latencyTier: LatencyTier, tasks: ParallelWorkTaskInput[]): string {
  return `pwork-${stableHash({
    requestId,
    latencyTier,
    tasks: tasks.map((task) => ({
      id: task.id,
      dependsOn: task.dependsOn ?? [],
      readSet: task.readSet ?? [],
      writeSet: task.writeSet ?? [],
      owner: task.owner.id,
    })),
  }).slice(0, 12)}`;
}

function stableHash(value: unknown): string {
  let hash = 2166136261;
  const text = JSON.stringify(value);
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
