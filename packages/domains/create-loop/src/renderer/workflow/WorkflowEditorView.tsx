import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange
} from '@xyflow/react'
import { ArrowLeft, History, Play, Plus, Save, Square } from 'lucide-react'
import type {
  WorkflowConnectionV1,
  WorkflowEnvVarV1,
  WorkflowNodeKind,
  WorkflowNodeRunResultV1,
  WorkflowNodeRunStatus,
  WorkflowNodeV1,
  WorkflowV1
} from '../../contract.js'
import type { CreateLoopRendererSettings } from '../runtime-bridge.js'
import {
  NODE_ICONS,
  WorkflowNodeActionsContext,
  WorkflowRunStatusContext,
  workflowNodeTypes,
  type WorkflowNodeActions
} from './WorkflowNodes'
import { NodeConfigPanel } from './NodeConfigPanel'
import { WorkflowRunHistory } from './WorkflowRunHistory'
import { WorkflowRunLogPanel } from './WorkflowRunLogPanel'
import {
  WORKFLOW_PALETTE_GROUPS,
  createWorkflowNode,
  flowToWorkflowGraph,
  toFlowEdges,
  toFlowNodes,
  type WorkflowFlowEdge,
  type WorkflowFlowNode
} from './workflow-types'

type PersistPatch = {
  name: string
  enabled: boolean
  env: WorkflowEnvVarV1[]
  nodes: WorkflowNodeV1[]
  connections: WorkflowConnectionV1[]
}

type Props = {
  workflow: WorkflowV1
  settings: CreateLoopRendererSettings
  runStatus: Record<string, WorkflowNodeRunStatus>
  lastResults: Record<string, WorkflowNodeRunResultV1>
  liveResults: Record<string, WorkflowNodeRunResultV1>
  running: boolean
  onPersist: (patch: PersistPatch) => Promise<void>
  onRun: () => Promise<void> | void
  onRunNode: (nodeId: string) => Promise<void> | void
  onStop: () => Promise<void> | void
  onBack: () => void
}

type PanelMode = 'config' | 'run'
type UpstreamNode = { id: string; name: string; type: WorkflowNodeV1['type']; node: WorkflowNodeV1 }

function nextNodePosition(count: number): { x: number; y: number } {
  const column = count % 3
  const row = Math.floor(count / 3)
  return { x: 120 + column * 260, y: 120 + row * 160 }
}

function resultSource(
  liveResults: Record<string, WorkflowNodeRunResultV1>,
  lastResults: Record<string, WorkflowNodeRunResultV1>
): Record<string, WorkflowNodeRunResultV1> {
  return Object.keys(liveResults).length > 0 ? liveResults : lastResults
}

function reachableInputs(
  nodes: WorkflowFlowNode[],
  edges: WorkflowFlowEdge[],
  selectedNodeId: string | null
): UpstreamNode[] {
  if (!selectedNodeId) return []
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
  }
  const seen = new Set<string>()
  const queue = [...(incoming.get(selectedNodeId) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id || seen.has(id)) continue
    seen.add(id)
    queue.push(...(incoming.get(id) ?? []))
  }
  return nodes
    .filter((node) => seen.has(node.id))
    .map((node) => ({
      id: node.data.node.id,
      name: node.data.node.name,
      type: node.data.node.type,
      node: node.data.node
    }))
}

function WorkflowEditorInner({
  workflow,
  settings,
  runStatus,
  lastResults,
  liveResults,
  running,
  onPersist,
  onRun,
  onRunNode,
  onStop,
  onBack
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [name, setName] = useState(workflow.name)
  const [enabled, setEnabled] = useState(workflow.enabled)
  const [nodes, setNodes] = useState<WorkflowFlowNode[]>(() => toFlowNodes(workflow.nodes))
  const [edges, setEdges] = useState<WorkflowFlowEdge[]>(() => toFlowEdges(workflow.connections))
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(workflow.nodes[0]?.id ?? null)
  const [mode, setMode] = useState<PanelMode>('config')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const results = useMemo(() => resultSource(liveResults, lastResults), [lastResults, liveResults])
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId)?.data.node ?? null,
    [nodes, selectedNodeId]
  )
  const upstreamNodes = useMemo(
    () => reachableInputs(nodes, edges, selectedNodeId),
    [edges, nodes, selectedNodeId]
  )
  const displayEdges = useMemo(
    () => toFlowEdges(flowToWorkflowGraph(nodes, edges).connections, runStatus),
    [edges, nodes, runStatus]
  )

  useEffect(() => {
    if (running) setMode('run')
  }, [running])

  useEffect(() => {
    if (!selectedNodeId || nodes.some((node) => node.id === selectedNodeId)) return
    setSelectedNodeId(nodes[0]?.id ?? null)
  }, [nodes, selectedNodeId])

  const markDirty = useCallback(() => setDirty(true), [])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current) as WorkflowFlowNode[])
    if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) markDirty()
  }, [markDirty])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current) as WorkflowFlowEdge[])
    if (changes.some((change) => change.type !== 'select')) markDirty()
  }, [markDirty])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge(connection, current) as WorkflowFlowEdge[])
    markDirty()
  }, [markDirty])

  const addNode = useCallback((kind: WorkflowNodeKind) => {
    const node = createWorkflowNode(kind, nextNodePosition(nodes.length))
    setNodes((current) => [...current, { id: node.id, type: node.type, position: node.position, data: { node } }])
    setSelectedNodeId(node.id)
    setMode('config')
    markDirty()
  }, [markDirty, nodes.length])

  const updateNode = useCallback((updated: WorkflowNodeV1) => {
    setNodes((current) =>
      current.map((node) => node.id === updated.id ? { ...node, type: updated.type, data: { node: updated } } : node)
    )
    markDirty()
  }, [markDirty])

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId))
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId))
    setSelectedNodeId((current) => current === nodeId ? null : current)
    markDirty()
  }, [markDirty])

  const toggleNode = useCallback((nodeId: string) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? { ...node, data: { node: { ...node.data.node, disabled: !node.data.node.disabled } } }
          : node
      )
    )
    markDirty()
  }, [markDirty])

  const graphPatch = useCallback((): PersistPatch => {
    const graph = flowToWorkflowGraph(nodes, edges)
    return {
      name: name.trim() || t('workflowUntitled'),
      enabled,
      env: workflow.env,
      nodes: graph.nodes,
      connections: graph.connections
    }
  }, [edges, enabled, name, nodes, t, workflow.env])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await onPersist(graphPatch())
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [graphPatch, onPersist])

  const runWorkflow = useCallback(async () => {
    await onPersist(graphPatch())
    setDirty(false)
    await onRun()
  }, [graphPatch, onPersist, onRun])

  const runNode = useCallback(async (nodeId: string) => {
    await onPersist(graphPatch())
    setDirty(false)
    await onRunNode(nodeId)
  }, [graphPatch, onPersist, onRunNode])

  const nodeActions = useMemo<WorkflowNodeActions>(
    () => ({
      runNode: (nodeId) => void runNode(nodeId),
      toggleDisabled: toggleNode,
      deleteNode
    }),
    [deleteNode, runNode, toggleNode]
  )

  return (
    <div className="ds-no-drag fixed inset-0 z-[60] flex flex-col bg-ds-main">
      <header
        className="ds-drag flex shrink-0 items-center gap-3 border-b border-ds-border py-2.5 pr-4"
        style={{ paddingLeft: 'calc(var(--ds-window-controls-safe-inset) + 2.5rem)' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[13px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          {t('workflowBack')}
        </button>
        <input
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[15px] font-medium text-ds-ink outline-none focus:border-ds-border focus:bg-ds-card"
          value={name}
          placeholder={t('workflowNamePlaceholder')}
          onChange={(event) => {
            setName(event.target.value)
            markDirty()
          }}
        />
        <label className="inline-flex shrink-0 items-center gap-2 text-[13px] font-medium text-ds-muted">
          {t('workflowEnabled')}
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked)
              markDirty()
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          title={t('workflowRunHistory')}
          aria-label={t('workflowRunHistory')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <History className="h-4 w-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[13px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:opacity-60"
        >
          <Save className="h-4 w-4" strokeWidth={1.8} />
          {dirty ? t('workflowSave') : t('workflowSaved')}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => void onStop()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-500/90 px-4 text-[13px] font-semibold text-white transition hover:bg-red-500"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} />
            {t('workflowStop')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void runWorkflow()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ds-userbubble px-4 text-[13px] font-semibold text-ds-userbubbleFg transition hover:opacity-90"
          >
            <Play className="h-4 w-4" strokeWidth={2} />
            {t('workflowRunNow')}
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[196px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-ds-border bg-ds-card/40 p-3">
          <span className="text-[11px] font-semibold uppercase text-ds-faint">{t('workflowPalette')}</span>
          {WORKFLOW_PALETTE_GROUPS.map((group) => (
            <section key={group.id} className="flex flex-col gap-1">
              <h2 className="px-1 text-[10.5px] font-semibold uppercase text-ds-faint">{t(`workflowGroup_${group.id}`)}</h2>
              {group.kinds.map((kind) => {
                const Icon = NODE_ICONS[kind]
                return (
                  <button
                    type="button"
                    key={kind}
                    onClick={() => addNode(kind)}
                    className="flex h-9 items-center gap-2 rounded-lg border border-transparent px-2 text-left text-[12.5px] text-ds-ink transition hover:border-ds-border hover:bg-ds-hover"
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t(`workflowNode_${kind}`)}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                  </button>
                )
              })}
            </section>
          ))}
        </aside>

        <main className="relative min-w-0 flex-1">
          <WorkflowRunStatusContext.Provider value={runStatus}>
            <WorkflowNodeActionsContext.Provider value={nodeActions}>
              <ReactFlow
                className="ds-workflow-canvas"
                nodes={nodes}
                edges={displayEdges}
                nodeTypes={workflowNodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id)
                  setMode('config')
                }}
                onPaneClick={() => setSelectedNodeId(null)}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
                minZoom={0.2}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </WorkflowNodeActionsContext.Provider>
          </WorkflowRunStatusContext.Provider>
          {nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-[13px] text-ds-faint">
              {t('workflowEmptyCanvas')}
            </div>
          ) : null}
        </main>

        <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-ds-border bg-ds-card/40">
          <div className="flex h-11 shrink-0 items-end gap-1 border-b border-ds-border px-2">
            {(['config', 'run'] as const).map((tab) => (
              <button
                type="button"
                key={tab}
                onClick={() => setMode(tab)}
                className={`relative px-3 py-2 text-[12.5px] font-medium transition ${
                  mode === tab ? 'text-ds-ink' : 'text-ds-faint hover:text-ds-muted'
                }`}
              >
                {tab === 'config' ? t('workflowTabConfig') : t('workflowTabRunLog')}
                {mode === tab ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {mode === 'config' ? (
              <NodeConfigPanel
                node={selectedNode}
                settings={settings}
                lastResult={selectedNodeId ? results[selectedNodeId] ?? null : null}
                onChange={updateNode}
                onDelete={deleteNode}
                workflowName={name}
                upstreamNodes={upstreamNodes}
                workflowId={workflow.id}
                onBeforeTest={save}
              />
            ) : (
              <WorkflowRunLogPanel nodes={flowToWorkflowGraph(nodes, edges).nodes} results={results} running={running} />
            )}
          </div>
        </aside>
      </div>

      {historyOpen ? (
        <WorkflowRunHistory runs={workflow.runs} nodes={flowToWorkflowGraph(nodes, edges).nodes} onClose={() => setHistoryOpen(false)} />
      ) : null}
    </div>
  )
}

export function WorkflowEditorView(props: Props): ReactElement {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  )
}

export type WorkflowEditorProps = Props
