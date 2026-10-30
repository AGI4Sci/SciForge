import type {
  AgentRuntimeId,
  AgentRuntimeThreadGoal,
  AgentRuntimeThreadGoalStatus
} from '../../shared/agent-runtime-contract'
import {
  atomicWriteAppDataJson,
  readAppDataStoreText
} from './app-data-store'

type StoredRuntimeGoals = {
  goals: AgentRuntimeThreadGoal[]
}

const RUNTIME_GOALS_STORE = ['runtime-goals', 'goals.json'] as const

export type RuntimeGoalPatch = {
  objective?: string
  status?: AgentRuntimeThreadGoalStatus
  tokenBudget?: number | null
}

export class RuntimeGoalService {
  private loaded: Promise<StoredRuntimeGoals> | null = null

  constructor(private readonly dataDir: string) {}

  async listForRuntime(runtimeId: AgentRuntimeId): Promise<AgentRuntimeThreadGoal[]> {
    const store = await this.load()
    return store.goals.filter((goal) => goal.runtimeId === runtimeId)
  }

  async get(input: {
    runtimeId: AgentRuntimeId
    threadId: string
  }): Promise<AgentRuntimeThreadGoal | null> {
    const store = await this.load()
    return store.goals.find((goal) => goal.runtimeId === input.runtimeId && goal.threadId === input.threadId) ?? null
  }

  async set(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    patch: RuntimeGoalPatch
  }): Promise<AgentRuntimeThreadGoal> {
    const threadId = input.threadId.trim()
    if (!threadId) throw new Error('threadId is required.')
    const objective = input.patch.objective?.trim()
    const status = normalizeStatus(input.patch.status)
    const tokenBudget = normalizeTokenBudget(input.patch.tokenBudget)
    if (input.patch.tokenBudget !== undefined && tokenBudget === false) {
      throw new Error('tokenBudget must be a positive integer or null.')
    }

    const store = await this.load()
    const index = store.goals.findIndex((goal) => goal.runtimeId === input.runtimeId && goal.threadId === threadId)
    const existing = index >= 0 ? store.goals[index] : null
    if (!existing && !objective) {
      throw new Error(`cannot update goal for thread ${threadId}: no goal exists`)
    }

    const now = new Date().toISOString()
    const goal: AgentRuntimeThreadGoal = {
      runtimeId: input.runtimeId,
      threadId,
      objective: objective ?? existing?.objective ?? '',
      status: status ?? (objective ? 'active' : existing?.status ?? 'active'),
      ...(tokenBudget === false || tokenBudget === undefined
        ? existing?.tokenBudget !== undefined ? { tokenBudget: existing.tokenBudget } : {}
        : tokenBudget === null ? {} : { tokenBudget }),
      tokensUsed: existing?.tokensUsed ?? 0,
      timeUsedSeconds: existing?.timeUsedSeconds ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    if (index >= 0) store.goals[index] = goal
    else store.goals.unshift(goal)
    await this.save(store)
    return goal
  }

  async clear(input: {
    runtimeId: AgentRuntimeId
    threadId: string
  }): Promise<boolean> {
    const threadId = input.threadId.trim()
    if (!threadId) return false
    const store = await this.load()
    const next = store.goals.filter((goal) => !(goal.runtimeId === input.runtimeId && goal.threadId === threadId))
    if (next.length === store.goals.length) return false
    store.goals = next
    await this.save(store)
    return true
  }

  private async load(): Promise<StoredRuntimeGoals> {
    if (!this.loaded) {
      this.loaded = readAppDataStoreText(this.dataDir, RUNTIME_GOALS_STORE)
        .then((raw) => normalizeStore(JSON.parse(raw) as unknown))
        .catch(() => ({ goals: [] }))
    }
    return this.loaded
  }

  private async save(store: StoredRuntimeGoals): Promise<void> {
    await atomicWriteAppDataJson(this.dataDir, RUNTIME_GOALS_STORE, normalizeStore(store))
  }
}

function normalizeStore(value: unknown): StoredRuntimeGoals {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { goals?: unknown }).goals)) {
    return { goals: [] }
  }
  return {
    goals: (value as { goals: unknown[] }).goals
      .map(normalizeGoal)
      .filter((goal): goal is AgentRuntimeThreadGoal => goal != null)
  }
}

function normalizeGoal(value: unknown): AgentRuntimeThreadGoal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const runtimeId = normalizeRuntimeId(record.runtimeId)
  const threadId = stringValue(record.threadId)
  const objective = stringValue(record.objective)
  const status = normalizeStatus(record.status)
  const createdAt = stringValue(record.createdAt) || new Date().toISOString()
  const updatedAt = stringValue(record.updatedAt) || createdAt
  if (!runtimeId || !threadId || !objective || !status) return null
  return {
    runtimeId,
    threadId,
    objective,
    status,
    ...(typeof record.tokenBudget === 'number' && Number.isFinite(record.tokenBudget) && record.tokenBudget > 0
      ? { tokenBudget: Math.floor(record.tokenBudget) }
      : {}),
    tokensUsed: nonNegativeInteger(record.tokensUsed),
    timeUsedSeconds: nonNegativeInteger(record.timeUsedSeconds),
    createdAt,
    updatedAt
  }
}

function normalizeRuntimeId(value: unknown): AgentRuntimeId | null {
  return value === 'codex' || value === 'claude' || value === 'dsh' ? value : null
}

function normalizeStatus(value: unknown): AgentRuntimeThreadGoalStatus | undefined {
  return value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete'
    ? value
    : undefined
}

function normalizeTokenBudget(value: unknown): number | null | undefined | false {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return false
  return value
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
