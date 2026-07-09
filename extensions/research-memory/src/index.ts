export * from './types.js'
export * from './evidence-gate.js'
export * from './artifact-parser.js'
export * from './store.js'
export * from './service.js'

import { isAbsolute, relative, resolve } from 'node:path'
import type { ToolHostContext } from './tool-types.js'
import { createResearchMemoryService } from './service.js'

type DefineTool = (tool: {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  policy?: 'auto' | 'on-request' | 'suggest' | 'never' | 'untrusted'
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
  execute: (args: Record<string, unknown>, context: ToolHostContext) => Promise<{ output: unknown; isError?: boolean }>
}) => unknown

export function createProjectExtensionTools(input: {
  defineTool: DefineTool
}): unknown[] {
  const defineTool = input.defineTool
  return [
    defineTool({
      name: 'research_memory_record_experiment',
      description: 'Record a project-scoped experiment run with metrics, logs, artifacts, and traceable evidence refs.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          id: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['completed', 'failed', 'aborted', 'running'] },
          command: { type: 'string' },
          scriptPath: { type: 'string' },
          datasetVersion: { type: 'string' },
          environment: { type: 'object' },
          parameters: { type: 'object' },
          seed: {},
          metrics: { type: 'object' },
          metricsPath: { type: 'string' },
          logsExcerpt: { type: 'string' },
          logPath: { type: 'string' },
          artifactRefs: { type: 'array', items: { type: 'string' } },
          artifactManifestPath: { type: 'string' },
          threadRef: { type: 'string' },
          turnRef: { type: 'string' }
        },
        required: ['title'],
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => {
        enforceRecordExperimentPathPolicy(args, context)
        return { output: withService(context, (service) => service.recordExperiment(args as never)) }
      }
    }),
    defineTool({
      name: 'research_memory_propose_insight',
      description: 'Propose a reusable research insight. Status is assigned by the evidence gate; callers cannot force active.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          type: {
            type: 'string',
            enum: [
              'experiment_insight',
              'negative_result',
              'method_choice',
              'analysis_insight',
              'debug_insight',
              'research_principle',
              'hypothesis',
              'metric_interpretation',
              'data_insight',
              'model_behavior_insight',
              'paper_claim',
              'figure_decision',
              'workflow_skill',
              'review_critique'
            ]
          },
          claim: { type: 'string' },
          rationale: { type: 'string' },
          recommendedAction: { type: 'string' },
          applicability: { type: 'object' },
          evidenceRefs: { type: 'array', items: { type: 'string' } },
          sourceRunIds: { type: 'array', items: { type: 'string' } },
          sourceThreadRefs: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          metadata: { type: 'object' }
        },
        required: ['type', 'claim'],
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => ({ output: withService(context, (service) => service.proposeInsight(args as never)) })
    }),
    defineTool({
      name: 'research_memory_reflect_experiments',
      description: 'Reflect over recorded experiment runs and create negative results, method choices, insights, and hypotheses.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          runIds: { type: 'array', items: { type: 'string' } },
          includeWeakCandidates: { type: 'boolean' }
        },
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => ({ output: withService(context, (service) => service.reflectExperiments(args as never)) })
    }),
    defineTool({
      name: 'research_memory_reflect_thread',
      description: 'Reflect a thread into candidate analysis memory with thread evidence.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          threadId: { type: 'string' },
          scope: { type: 'string', enum: ['recent_turns', 'full_thread', 'since_last_reflection'] },
          threadText: { type: 'string' },
          highlights: { type: 'array', items: { type: 'string' } },
          turns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                role: { type: 'string' },
                text: { type: 'string' }
              },
              required: ['text'],
              additionalProperties: false
            }
          }
        },
        required: ['threadId', 'scope'],
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => ({
        output: withService(context, (service) => service.reflectThread(normalizeReflectThreadArgs(args)))
      })
    }),
    defineTool({
      name: 'research_memory_resolve_context',
      description: 'Resolve relevant project research memory before a new task or next experiment plan.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          query: { type: 'string' },
          budgetChars: { type: 'number' },
          includeHypotheses: { type: 'boolean' }
        },
        required: ['query'],
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => ({
        output: withService(context, (service) => service.resolveContext(normalizeResolveContextArgs(args)))
      })
    }),
    defineTool({
      name: 'research_memory_review_item',
      description: 'Review a candidate or hypothesis by approving, rejecting, invalidating, superseding, or marking it as hypothesis.',
      inputSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string' },
          action: { type: 'string', enum: ['approve', 'reject', 'invalidate', 'supersede', 'mark_hypothesis'] },
          note: { type: 'string' },
          supersededBy: { type: 'string' }
        },
        required: ['memoryId', 'action'],
        additionalProperties: false
      },
      policy: 'on-request',
      execute: async (args, context) => ({ output: withService(context, (service) => service.reviewItem(args as never)) })
    }),
    defineTool({
      name: 'research_memory_snapshot',
      description: 'Write a markdown or JSON Research Memory snapshot into project artifacts.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          format: { type: 'string', enum: ['markdown', 'json'] }
        },
        required: ['format'],
        additionalProperties: false
      },
      policy: 'auto',
      execute: async (args, context) => ({ output: withService(context, (service) => service.snapshot(args as never)) })
    })
  ]
}

function withService<T>(context: ToolHostContext, action: (service: ReturnType<typeof createResearchMemoryService>) => T): T {
  const service = createResearchMemoryService({
    workspaceRoot: context.workspace,
    ...(context.project ? { projectId: context.project } : {})
  })
  try {
    return action(service)
  } finally {
    service.close()
  }
}

const REFLECT_THREAD_SCOPES = ['recent_turns', 'full_thread', 'since_last_reflection'] as const

type ReflectThreadScope = typeof REFLECT_THREAD_SCOPES[number]

function normalizeReflectThreadArgs(args: Record<string, unknown>): {
  projectId?: string
  threadId: string
  scope: ReflectThreadScope
  threadText?: string
  highlights?: string[]
  turns?: Array<{ id?: string; role?: string; text?: string }>
} {
  const threadId = nonEmptyString(args.threadId, 'threadId')
  const scope = typeof args.scope === 'string' && REFLECT_THREAD_SCOPES.includes(args.scope as ReflectThreadScope)
    ? args.scope as ReflectThreadScope
    : undefined
  if (!scope) {
    throw new Error('research_memory_reflect_thread.scope must be one of: recent_turns, full_thread, since_last_reflection')
  }
  const projectId = optionalString(args.projectId)
  const threadText = optionalString(args.threadText)
  const highlights = Array.isArray(args.highlights)
    ? args.highlights.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined
  const turns = Array.isArray(args.turns)
    ? args.turns.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const turn = value as Record<string, unknown>
      const text = optionalString(turn.text)
      if (!text) return []
      return [{
        ...(optionalString(turn.id) ? { id: optionalString(turn.id) } : {}),
        ...(optionalString(turn.role) ? { role: optionalString(turn.role) } : {}),
        text
      }]
    })
    : undefined
  return {
    ...(projectId ? { projectId } : {}),
    threadId,
    scope,
    ...(threadText ? { threadText } : {}),
    ...(highlights && highlights.length > 0 ? { highlights } : {}),
    ...(turns && turns.length > 0 ? { turns } : {})
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`research_memory_reflect_thread.${field} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeResolveContextArgs(args: Record<string, unknown>): {
  projectId?: string
  query: string
  budgetChars?: number
  includeHypotheses?: boolean
} {
  const query = optionalString(args.query)
  if (!query) {
    throw new Error('research_memory_resolve_context.query must be a non-empty string')
  }
  const projectId = optionalString(args.projectId)
  const budgetChars = typeof args.budgetChars === 'number' && Number.isFinite(args.budgetChars)
    ? args.budgetChars
    : undefined
  const includeHypotheses = typeof args.includeHypotheses === 'boolean' ? args.includeHypotheses : undefined
  return {
    ...(projectId ? { projectId } : {}),
    query,
    ...(budgetChars !== undefined ? { budgetChars } : {}),
    ...(includeHypotheses !== undefined ? { includeHypotheses } : {})
  }
}

const RECORD_EXPERIMENT_PATH_FIELDS = ['metricsPath', 'logPath', 'artifactManifestPath'] as const

function enforceRecordExperimentPathPolicy(args: Record<string, unknown>, context: ToolHostContext): void {
  for (const field of RECORD_EXPERIMENT_PATH_FIELDS) {
    const value = args[field]
    if (typeof value === 'string' && value.trim()) {
      assertAllowedToolPath(value, context)
    }
  }
}

function assertAllowedToolPath(rawPath: string, context: ToolHostContext): void {
  const path = normalizePolicyPath(rawPath, context.workspace)
  const workspace = resolve(context.workspace)
  if (!isPathWithinOrSame(path, workspace)) {
    throw new Error(`Research Memory file path must stay within the workspace: ${rawPath}`)
  }
  const policy = context.filePathPolicy
  if (!policy) return
  const allowPaths = (policy.allowPaths ?? []).map((allowedPath) => normalizePolicyPath(allowedPath, context.workspace))
  const allowPatterns = policy.allowPatterns ?? []
  const allowedByPath = allowPaths.length > 0 && allowPaths.some((allowedPath) => isPathWithinOrSame(path, allowedPath))
  const allowedByPattern = allowPatterns.length > 0 && allowPatterns.some((pattern) => regexMatches(pattern, path))
  if ((allowPaths.length > 0 || allowPatterns.length > 0) && !allowedByPath && !allowedByPattern) {
    throw new Error('Research Memory file path does not match this turn file path policy')
  }
  const denyPattern = (policy.denyPatterns ?? []).find((pattern) => regexMatches(pattern, path))
  if (denyPattern) {
    throw new Error(`Research Memory file path matched this turn file path policy denyPattern: ${denyPattern}`)
  }
}

function normalizePolicyPath(path: string, workspace: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(workspace, path)
}

function isPathWithinOrSame(path: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function regexMatches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}
