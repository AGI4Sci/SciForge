import type { ComponentType, ReactElement } from 'react'
import { createContext, useContext } from 'react'
import { Handle, NodeToolbar, Position, type NodeProps, type NodeTypes } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownUp,
  Blocks,
  Braces,
  Brain,
  CalendarClock,
  Code2,
  Database,
  Download,
  FileJson,
  Filter,
  GitBranch,
  GitMerge,
  Globe,
  Hand,
  ImagePlus,
  ListChecks,
  LogOut,
  Play,
  Power,
  Repeat,
  Scissors,
  Search,
  Sigma,
  Split,
  Tags,
  Timer,
  Trash2,
  Type,
  UserCheck,
  Webhook,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import type { WorkflowNodeKind, WorkflowNodeRunStatus, WorkflowNodeV1 } from '../../contract.js'
import { WORKFLOW_NODE_KINDS } from '../../contract.js'
import type { WorkflowFlowNodeData } from './workflow-types'

/** workflowId-scoped live node status, provided by the editor and read by each node. */
export const WorkflowRunStatusContext = createContext<Record<string, WorkflowNodeRunStatus>>({})

export type WorkflowNodeActions = {
  runNode: (nodeId: string) => void
  toggleDisabled: (nodeId: string) => void
  deleteNode: (nodeId: string) => void
}

export const WorkflowNodeActionsContext = createContext<WorkflowNodeActions>({
  runNode: () => {},
  toggleDisabled: () => {},
  deleteNode: () => {}
})

export const NODE_ICONS: Record<WorkflowNodeKind, LucideIcon> = {
  'manual-trigger': Hand,
  'schedule-trigger': CalendarClock,
  'webhook-trigger': Webhook,
  llm: Brain,
  'ai-agent': Brain,
  'generate-image': ImagePlus,
  condition: GitBranch,
  switch: Split,
  filter: Filter,
  'set-fields': Braces,
  code: Code2,
  sort: ArrowDownUp,
  limit: Scissors,
  aggregate: Sigma,
  'research-search': Search,
  'paper-download': Download,
  'http-request': Globe,
  resource: Database,
  merge: GitMerge,
  subworkflow: Workflow,
  loop: Repeat,
  delay: Timer,
  template: Type,
  json: FileJson,
  output: LogOut,
  'parameter-extractor': ListChecks,
  'question-classifier': Tags,
  'human-approval': UserCheck,
  custom: Blocks
}

function statusDotClass(status: WorkflowNodeRunStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'bg-amber-500 animate-pulse'
    case 'success':
      return 'bg-emerald-500'
    case 'error':
      return 'bg-red-500'
    case 'skipped':
      return 'bg-ds-border'
    default:
      return 'bg-transparent'
  }
}

function nodeSummary(node: WorkflowNodeV1): string {
  switch (node.type) {
    case 'schedule-trigger': {
      const s = node.config.schedule
      if (s.kind === 'cron') return s.cron || 'cron'
      if (s.kind === 'interval') return `${s.everyMinutes}m`
      if (s.kind === 'daily') return s.timeOfDay
      if (s.kind === 'at') return s.atTime ? new Date(s.atTime).toLocaleString() : 'once'
      return 'manual'
    }
    case 'webhook-trigger':
      return `${node.config.method} ${node.config.path}`.trim()
    case 'llm':
      return node.config.prompt.trim().slice(0, 60) || node.config.model || 'LLM'
    case 'ai-agent':
      return node.config.prompt.trim().slice(0, 60) || node.config.model || 'AI task'
    case 'generate-image':
      return node.config.prompt.trim().slice(0, 60) || 'image'
    case 'condition':
      return `${node.config.leftExpr || 'text'} ${node.config.operator} ${node.config.rightValue}`.trim()
    case 'switch':
      return `${node.config.rules.length} rules${node.config.fallback ? ' + fallback' : ''}`
    case 'filter':
      return `${node.config.leftExpr || 'text'} ${node.config.operator} ${node.config.rightValue}`.trim()
    case 'set-fields':
      return node.config.fields.map((field) => field.key).filter(Boolean).join(', ')
    case 'code':
      return node.config.language === 'python' ? 'Python' : node.config.language === 'bash' ? 'Shell' : 'JS'
    case 'sort':
      return `${node.config.field || 'item'} ${node.config.order}`
    case 'limit':
      return `${node.config.from} ${node.config.count}`
    case 'aggregate':
      return node.config.field ? `${node.config.mode}(${node.config.field})` : node.config.mode
    case 'research-search':
      return `${node.config.intent} · ${node.config.maxResults}`
    case 'paper-download':
      return `${node.config.outputDir || 'papers'} · ${node.config.maxFiles}`
    case 'http-request':
      return `${node.config.method} ${node.config.url}`.trim()
    case 'resource':
      return [node.config.resourceName || node.config.resourceId, node.config.operationId]
        .filter(Boolean)
        .join(' · ')
    case 'merge':
      return node.config.mode
    case 'loop':
      return node.config.mode === 'foreach'
        ? `foreach${node.config.execution === 'parallel' ? ` ∥${node.config.concurrency ?? 4}` : ''}`
        : `≤${node.config.maxIterations}×`
    case 'delay':
      return `${Math.round(node.config.delayMs / 1000)}s`
    case 'template':
      return node.config.template.trim().slice(0, 40) || node.config.outputMode
    case 'json':
      return node.config.mode
    case 'output':
      return node.config.mode === 'json' && node.config.jsonPath.trim()
        ? `json: ${node.config.jsonPath.trim()}`
        : node.config.mode
    case 'parameter-extractor':
      return `${node.config.fields.length} field(s)`
    case 'question-classifier':
      return `${node.config.categories.length} categories`
    case 'human-approval':
      return node.config.title.trim() || 'pause'
    default:
      return ''
  }
}

type NodeVisual = Readonly<{
  shell: string
  icon: string
}>

function nodeVisual(node: WorkflowNodeV1): NodeVisual {
  if (
    node.type === 'manual-trigger' ||
    node.type === 'schedule-trigger' ||
    node.type === 'webhook-trigger'
  ) {
    return {
      shell: 'rounded-full border-slate-300/80 bg-slate-50/80 dark:border-slate-600/80 dark:bg-slate-900/35',
      icon: 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
    }
  }
  if (node.type === 'llm' || node.type === 'ai-agent' || node.type === 'custom') {
    return {
      shell: 'rounded-lg border-violet-300/80 bg-violet-50/75 dark:border-violet-700/80 dark:bg-violet-950/20',
      icon: 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
    }
  }
  if (
    node.type === 'research-search' ||
    node.type === 'paper-download' ||
    node.type === 'http-request' ||
    node.type === 'resource'
  ) {
    return {
      shell: 'rounded-md border-teal-300/80 bg-teal-50/75 dark:border-teal-700/80 dark:bg-teal-950/20',
      icon: 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
    }
  }
  if (
    node.type === 'condition' ||
    node.type === 'switch' ||
    node.type === 'filter' ||
    node.type === 'merge' ||
    node.type === 'loop' ||
    node.type === 'delay'
  ) {
    return {
      shell: 'rounded-md border-amber-300/80 bg-amber-50/80 dark:border-amber-700/80 dark:bg-amber-950/20',
      icon: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
    }
  }
  if (node.type === 'human-approval') {
    return {
      shell: 'rounded-lg border-rose-300/80 bg-rose-50/75 dark:border-rose-700/80 dark:bg-rose-950/20',
      icon: 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
    }
  }
  if (node.type === 'output') {
    return {
      shell: 'rounded-r-lg rounded-bl-lg border-slate-300/80 bg-slate-50/80 dark:border-slate-600/80 dark:bg-slate-900/35',
      icon: 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
    }
  }
  return {
    shell: 'rounded-lg border-cyan-300/80 bg-cyan-50/75 dark:border-cyan-700/80 dark:bg-cyan-950/20',
    icon: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
  }
}

const TOOLBAR_BTN =
  'nodrag nopan flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink'

function WorkflowCanvasNode({ id, data, selected }: NodeProps): ReactElement {
  const { t } = useTranslation('common')
  const runStatus = useContext(WorkflowRunStatusContext)
  const actions = useContext(WorkflowNodeActionsContext)
  const node = (data as WorkflowFlowNodeData).node
  const Icon = NODE_ICONS[node.type]
  const status = runStatus[id]
  const isTrigger =
    node.type === 'manual-trigger' || node.type === 'schedule-trigger' || node.type === 'webhook-trigger'
  const isCondition = node.type === 'condition'
  const summary = nodeSummary(node)
  const visual = nodeVisual(node)

  const ring = selected ? 'border-accent ring-2 ring-accent/30' : ''
  const disabled = node.disabled ? 'opacity-50' : ''

  return (
    <div
      className={`relative w-[260px] border px-3 py-2.5 shadow-sm transition-shadow hover:shadow-md ${visual.shell} ${ring} ${disabled}`}
      title="Inspect this node's live input and output"
    >
      <NodeToolbar isVisible={selected} position={Position.Top} offset={8}>
        <div className="flex items-center gap-0.5 rounded-lg border border-ds-border bg-ds-card p-1 shadow-md">
          {!isTrigger ? (
            <button
              type="button"
              className={TOOLBAR_BTN}
              title={t('workflowRunNode')}
              aria-label={t('workflowRunNode')}
              onClick={() => actions.runNode(id)}
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.9} />
            </button>
          ) : null}
          <button
            type="button"
            className={TOOLBAR_BTN}
            title={node.disabled ? t('workflowEnableNode') : t('workflowDisableNode')}
            aria-label={node.disabled ? t('workflowEnableNode') : t('workflowDisableNode')}
            onClick={() => actions.toggleDisabled(id)}
          >
            <Power className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className={`${TOOLBAR_BTN} hover:bg-red-500/10 hover:text-red-600`}
            title={t('workflowDeleteNode')}
            aria-label={t('workflowDeleteNode')}
            onClick={() => actions.deleteNode(id)}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        </div>
      </NodeToolbar>

      {!isTrigger ? (
        <Handle type="target" position={Position.Left} id="in" />
      ) : null}
      {!isTrigger ? <Handle type="target" position={Position.Right} id="in-right" className="!opacity-0" /> : null}
      {!isTrigger ? <Handle type="target" position={Position.Top} id="in-top" className="!opacity-0" /> : null}
      {!isTrigger ? <Handle type="target" position={Position.Bottom} id="in-bottom" className="!opacity-0" /> : null}

      <div className="flex items-start gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${visual.icon}`}>
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="line-clamp-2 text-[13px] font-semibold leading-4 text-ds-ink">
            {node.name.trim() || t(`workflowNode_${node.type}`)}
          </div>
          {summary ? (
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-ds-faint">{summary}</div>
          ) : null}
        </div>
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(status)}`} />
      </div>

      {node.type === 'condition' ? (
        <>
          <Handle type="source" position={Position.Right} id="true" style={{ top: '38%' }} />
          <Handle type="source" position={Position.Right} id="false" style={{ top: '70%' }} />
          <div className="pointer-events-none absolute right-1 top-[30%] text-[9px] font-medium text-emerald-600">
            {t('workflowConditionTrue')}
          </div>
          <div className="pointer-events-none absolute right-1 top-[62%] text-[9px] font-medium text-red-500">
            {t('workflowConditionFalse')}
          </div>
        </>
      ) : node.type === 'switch' ? (
        <>
          {node.config.rules.map((_, index) => {
            const total = node.config.rules.length + (node.config.fallback ? 1 : 0)
            const top = ((index + 1) / (total + 1)) * 100
            return (
              <div key={`case-${index}`}>
                <Handle type="source" position={Position.Right} id={`case-${index}`} style={{ top: `${top}%` }} />
                <div
                  className="pointer-events-none absolute right-1 text-[9px] font-medium text-ds-faint"
                  style={{ top: `calc(${top}% - 7px)` }}
                >
                  {index + 1}
                </div>
              </div>
            )
          })}
          {node.config.fallback ? (
            <Handle type="source" position={Position.Right} id="fallback" style={{ top: '88%' }} />
          ) : null}
        </>
      ) : node.type === 'human-approval' ? (
        <>
          <Handle type="source" position={Position.Right} id="approved" style={{ top: '38%' }} />
          <Handle type="source" position={Position.Right} id="rejected" style={{ top: '70%' }} />
          <div className="pointer-events-none absolute right-1 top-[30%] text-[9px] font-medium text-emerald-600">
            {t('workflowApprovalApproved')}
          </div>
          <div className="pointer-events-none absolute right-1 top-[62%] text-[9px] font-medium text-red-500">
            {t('workflowApprovalRejected')}
          </div>
        </>
      ) : node.type === 'question-classifier' ? (
        <>
          {node.config.categories.map((category, index) => {
            const top = ((index + 1) / (node.config.categories.length + 1)) * 100
            return (
              <div key={category.id}>
                <Handle type="source" position={Position.Right} id={category.id} style={{ top: `${top}%` }} />
                <div
                  className="pointer-events-none absolute right-1 max-w-[60px] truncate text-[9px] font-medium text-ds-faint"
                  style={{ top: `calc(${top}% - 7px)` }}
                >
                  {category.label || index + 1}
                </div>
              </div>
            )
          })}
        </>
      ) : node.type === 'output' ? null : (
        <>
          <Handle type="source" position={Position.Right} id="out" />
          <Handle type="source" position={Position.Left} id="out-left" className="!opacity-0" />
          <Handle type="source" position={Position.Top} id="out-top" className="!opacity-0" />
          <Handle type="source" position={Position.Bottom} id="out-bottom" className="!opacity-0" />
        </>
      )}
    </div>
  )
}

const sharedNode = WorkflowCanvasNode as ComponentType<NodeProps>

// Every kind renders through the same shell; derive the map from the canonical
// kind list so a newly added node type can never silently fall back to React
// Flow's default (unstyled) node renderer.
export const workflowNodeTypes: NodeTypes = Object.fromEntries(
  WORKFLOW_NODE_KINDS.map((kind) => [kind, sharedNode])
)
