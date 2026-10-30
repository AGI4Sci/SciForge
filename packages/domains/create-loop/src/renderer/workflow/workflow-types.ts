import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type {
  WorkflowConnectionV1,
  WorkflowCustomModuleV1,
  WorkflowNodeKind,
  WorkflowNodePresetV1,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowV1
} from '../../contract.js'

export const WORKFLOW_PALETTE: readonly WorkflowNodeKind[] = [
  'manual-trigger',
  'schedule-trigger',
  'webhook-trigger',
  'llm',
  'ai-agent',
  'generate-image',
  'condition',
  'switch',
  'filter',
  'set-fields',
  'code',
  'sort',
  'limit',
  'aggregate',
  'research-search',
  'paper-download',
  'http-request',
  'merge',
  'subworkflow',
  'loop',
  'delay',
  'template',
  'json',
  'output',
  'parameter-extractor',
  'question-classifier',
  'human-approval'
]

export const TRIGGER_KINDS: ReadonlySet<WorkflowNodeKind> = new Set([
  'manual-trigger',
  'schedule-trigger',
  'webhook-trigger'
])

/** Palette grouping shown in the editor sidebar / insert menu. `id` maps to the `workflowGroup_<id>` label. */
export type WorkflowPaletteGroup = { id: string; kinds: readonly WorkflowNodeKind[] }
export const WORKFLOW_PALETTE_GROUPS: readonly WorkflowPaletteGroup[] = [
  { id: 'trigger', kinds: ['manual-trigger', 'schedule-trigger', 'webhook-trigger'] },
  { id: 'ai', kinds: ['llm', 'ai-agent', 'generate-image', 'parameter-extractor'] },
  { id: 'flow', kinds: ['condition', 'switch', 'question-classifier', 'filter', 'merge', 'loop', 'human-approval'] },
  { id: 'data', kinds: ['set-fields', 'template', 'json', 'code', 'sort', 'limit', 'aggregate'] },
  { id: 'action', kinds: ['research-search', 'paper-download', 'http-request', 'subworkflow', 'delay', 'output'] }
]

export type WorkflowFlowNodeData = {
  node: WorkflowNodeV1
  [key: string]: unknown
}
export type WorkflowFlowNode = Node<WorkflowFlowNodeData>
export type WorkflowFlowEdge = Edge

function uid(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
  return `${prefix}-${random}`
}

export function createWorkflowNode(
  kind: WorkflowNodeKind,
  position: { x: number; y: number }
): WorkflowNodeV1 {
  const base = { id: uid('node'), name: '', position, disabled: false }
  switch (kind) {
    case 'manual-trigger':
      return { ...base, type: 'manual-trigger', config: { workspaceRoot: '' } }
    case 'schedule-trigger':
      return {
        ...base,
        type: 'schedule-trigger',
        config: {
          schedule: { kind: 'interval', everyMinutes: 60, timeOfDay: '09:00', atTime: '', cron: '' },
          workspaceRoot: ''
        }
      }
    case 'webhook-trigger':
      return { ...base, type: 'webhook-trigger', config: { path: '/webhook', method: 'ANY', workspaceRoot: '' } }
    case 'llm':
      return {
        ...base,
        type: 'llm',
        config: { prompt: '', model: '', maxTokens: 0 }
      }
    case 'ai-agent':
      return {
        ...base,
        type: 'ai-agent',
        config: {
          prompt: '',
          workspaceRoot: '',
          providerId: '',
          model: '',
          reasoningEffort: 'medium',
          mode: 'agent',
          interaction: 'background'
        }
      }
    case 'generate-image':
      return {
        ...base,
        type: 'generate-image',
        config: { prompt: '', providerId: '', model: '', size: '', outputDir: '' }
      }
    case 'condition':
      return {
        ...base,
        type: 'condition',
        config: { leftExpr: '', operator: 'contains', rightValue: '', caseSensitive: false }
      }
    case 'switch':
      return {
        ...base,
        type: 'switch',
        config: { rules: [{ leftExpr: '', operator: 'contains', rightValue: '', caseSensitive: false }], fallback: true }
      }
    case 'filter':
      return {
        ...base,
        type: 'filter',
        config: { leftExpr: '', operator: 'contains', rightValue: '', caseSensitive: false }
      }
    case 'set-fields':
      return {
        ...base,
        type: 'set-fields',
        config: { fields: [{ key: '', value: '' }], keepIncoming: false }
      }
    case 'sort':
      return { ...base, type: 'sort', config: { field: '', order: 'asc', numeric: false } }
    case 'limit':
      return { ...base, type: 'limit', config: { count: 10, from: 'first' } }
    case 'aggregate':
      return { ...base, type: 'aggregate', config: { mode: 'count', field: '', separator: ', ' } }
    case 'research-search':
      return {
        ...base,
        type: 'research-search',
        config: {
          query: '{{text}}',
          intent: 'overview',
          domain: 'general',
          sinceYear: 0,
          maxResults: 10,
          sources: []
        }
      }
    case 'paper-download':
      return { ...base, type: 'paper-download', config: { outputDir: 'papers', maxFiles: 10 } }
    case 'code':
      return {
        ...base,
        type: 'code',
        config: { language: 'javascript', code: 'return $json' }
      }
    case 'merge':
      return { ...base, type: 'merge', config: { mode: 'array' } }
    case 'subworkflow':
      return { ...base, type: 'subworkflow', config: { workflowId: '' } }
    case 'loop':
      return {
        ...base,
        type: 'loop',
        config: {
          workflowId: '',
          mode: 'condition',
          arraySource: '',
          execution: 'sequential',
          concurrency: 4,
          continueOnError: false,
          maxIterations: 10,
          leftExpr: 'json.done',
          operator: 'equals',
          rightValue: 'true',
          caseSensitive: false
        }
      }
    case 'http-request':
      return {
        ...base,
        type: 'http-request',
        config: { method: 'GET', url: '', headers: [], body: '', timeoutMs: 30_000, parseJson: false }
      }
    case 'resource':
      return {
        ...base,
        type: 'resource',
        config: {
          providerId: '',
          resourceId: '',
          resourceName: '',
          operationId: '',
          inputTemplate: '{}'
        }
      }
    case 'delay':
      return { ...base, type: 'delay', config: { delayMs: 1_000 } }
    case 'template':
      return { ...base, type: 'template', config: { template: '', outputMode: 'text' } }
    case 'json':
      return { ...base, type: 'json', config: { mode: 'parse', strict: false } }
    case 'output':
      return { ...base, type: 'output', config: { mode: 'auto', textTemplate: '', jsonPath: '' } }
    case 'parameter-extractor':
      return {
        ...base,
        type: 'parameter-extractor',
        config: { source: '', instruction: '', fields: [], providerId: '', model: '', reasoningEffort: 'medium' }
      }
    case 'question-classifier':
      return {
        ...base,
        type: 'question-classifier',
        config: {
          source: '',
          instruction: '',
          categories: [{ id: 'cat-1', label: '' }],
          providerId: '',
          model: '',
          reasoningEffort: 'medium'
        }
      }
    case 'human-approval':
      return { ...base, type: 'human-approval', config: { title: '', instruction: '', timeoutMs: 0, onTimeout: 'rejected' } }
    case 'custom':
      return { ...base, type: 'custom', config: { moduleId: '', values: {} } }
    default:
      return { ...base, type: 'manual-trigger', config: {} }
  }
}

/** Build a `custom` node bound to a module, pre-filled with the module's field defaults. */
export function createCustomNode(
  module: WorkflowCustomModuleV1,
  position: { x: number; y: number }
): WorkflowNodeV1 {
  const values: Record<string, string> = {}
  for (const field of module.fields) values[field.key] = field.defaultValue
  return {
    id: uid('node'),
    type: 'custom',
    name: module.name,
    position,
    disabled: false,
    config: { moduleId: module.id, values }
  }
}

/** Build a node from a saved preset: a fresh id + position, the preset's name/config. */
export function createNodeFromPreset(
  preset: WorkflowNodePresetV1,
  position: { x: number; y: number }
): WorkflowNodeV1 {
  const fresh = createWorkflowNode(preset.nodeType, position)
  // preset.config matches preset.nodeType; clone so instances never share references.
  const config = structuredClone(preset.config)
  return { ...fresh, name: preset.nodeName || fresh.name, config } as WorkflowNodeV1
}

/** Snapshot a node into a reusable preset (id is assigned by the caller). */
export function presetFromNode(id: string, label: string, node: WorkflowNodeV1): WorkflowNodePresetV1 {
  return {
    id,
    label: label.trim() || node.name.trim() || node.type,
    icon: '',
    nodeType: node.type,
    nodeName: node.name,
    config: structuredClone(node.config)
  }
}

export function presetUid(): string {
  return uid('preset')
}

export function moduleUid(): string {
  return uid('module')
}

/** A blank custom module with a starter script. */
export function createCustomModule(name: string): WorkflowCustomModuleV1 {
  return {
    id: uid('module'),
    name,
    description: '',
    icon: '',
    language: 'javascript',
    fields: [],
    code: 'return { ok: true }'
  }
}

export function createWorkflow(name: string): WorkflowV1 {
  const now = new Date().toISOString()
  const trigger = createWorkflowNode('manual-trigger', { x: 80, y: 140 })
  return {
    id: uid('workflow'),
    name,
    enabled: false,
    callableByAgent: false,
    env: [],
    nodes: [trigger],
    connections: [],
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    runs: []
  }
}

const EDGE_DEFAULTS = {
  type: 'default',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }
} as const

export function toFlowNodes(nodes: WorkflowNodeV1[]): WorkflowFlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { node }
  }))
}

export function toFlowEdges(
  connections: WorkflowConnectionV1[],
  runStatus?: Record<string, WorkflowNodeRunStatus>
): WorkflowFlowEdge[] {
  return connections.map((connection) => ({
    id: connection.id,
    source: connection.source,
    sourceHandle: connection.sourceHandle || 'out',
    target: connection.target,
    targetHandle: connection.targetHandle || 'in',
    ...EDGE_DEFAULTS,
    animated: runStatus?.[connection.source] === 'running',
    className: runStatus?.[connection.source] === 'running' ? 'is-running' : undefined
  }))
}

export function flowToWorkflowGraph(
  rfNodes: WorkflowFlowNode[],
  rfEdges: WorkflowFlowEdge[]
): { nodes: WorkflowNodeV1[]; connections: WorkflowConnectionV1[] } {
  const nodes = rfNodes.map((rfNode) => ({
    ...rfNode.data.node,
    position: { x: Math.round(rfNode.position.x), y: Math.round(rfNode.position.y) }
  }))
  const connections: WorkflowConnectionV1[] = rfEdges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle || 'out',
    target: edge.target,
    targetHandle: edge.targetHandle || 'in'
  }))
  return { nodes, connections }
}
