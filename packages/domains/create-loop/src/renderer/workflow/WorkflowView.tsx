import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  Database,
  Download,
  Pencil,
  Play,
  Plus,
  Power,
  Square,
  Trash2,
  Upload,
  UserCheck,
  Workflow as WorkflowIcon,
  X,
  Zap
} from 'lucide-react'
import {
  type CreateDatasetLoopInput,
  type WorkflowHookTriggerV1,
  type WorkflowInputFieldV1,
  type WorkflowNodeRunResultV1,
  type WorkflowNodeV1,
  type WorkflowPendingApprovalV1,
  type WorkflowRuntimeStatus,
  type WorkflowApprovalDecision,
  type WorkflowV1
} from '../../contract.js'
import { mergeWorkflowSettings, normalizeWorkflowSettings } from '../../workflow-settings.js'
import { parseWorkflowDsl, serializeWorkflowDsl } from '../../workflow-dsl.js'
import {
  useCreateLoopRuntime,
  type CreateLoopRuntimeBridge,
  type CreateLoopRendererSettings
} from '../runtime-bridge.js'
import { WorkflowEditorView } from './WorkflowEditorView'
import { DatasetLoopDialog, type DatasetSourceOption } from './DatasetLoopDialog'
import { WorkflowHookTriggers } from './WorkflowHookTriggers'
import { createWorkflow } from './workflow-types'

type Props = {
  onCollapse?: () => void
}

const EMPTY_WORKFLOWS: WorkflowV1[] = []

export async function loadWorkflowViewState(
  runtime: Pick<CreateLoopRuntimeBridge, 'getSettings' | 'getWorkflowStatus'>
): Promise<Readonly<{
  settings: CreateLoopRendererSettings
  status: WorkflowRuntimeStatus | null
}>> {
  const [settingsResult, statusResult] = await Promise.allSettled([
    runtime.getSettings(),
    runtime.getWorkflowStatus()
  ])
  if (settingsResult.status === 'rejected') throw settingsResult.reason
  return {
    settings: settingsResult.value,
    status: statusResult.status === 'fulfilled' ? statusResult.value : null
  }
}

function statusTone(status: WorkflowV1['lastStatus']): string {
  if (status === 'running') return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
  if (status === 'success') return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-100'
  if (status === 'error') return 'bg-red-500/15 text-red-700 dark:text-red-100'
  return 'bg-ds-subtle text-ds-muted'
}

function formatDateTime(value: string, fallback: string): string {
  if (!value.trim()) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function WorkflowView({ onCollapse }: Props): ReactElement {
  const { t } = useTranslation('common')
  const runtime = useCreateLoopRuntime()
  const [settings, setSettings] = useState<CreateLoopRendererSettings | null>(null)
  const [status, setStatus] = useState<WorkflowRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [runInputTarget, setRunInputTarget] = useState<WorkflowV1 | null>(null)
  const [datasetBuilderOpen, setDatasetBuilderOpen] = useState(false)
  const [datasetBuilderLoading, setDatasetBuilderLoading] = useState(false)
  const [datasetBuilderSources, setDatasetBuilderSources] = useState<readonly DatasetSourceOption[]>([])

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await runtime.getWorkflowStatus())
    } catch {
      /* ignore transient status errors */
    }
  }, [runtime])

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await loadWorkflowViewState(runtime)
      setSettings(next.settings)
      if (next.status) setStatus(next.status)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [runtime])

  // Poll fast (1.2s) while something is running so the run log streams, slow (5s) when idle.
  const runningRef = useRef(false)
  useEffect(() => {
    runningRef.current = (status?.runningWorkflowIds.length ?? 0) > 0
  }, [status])
  useEffect(() => {
    void load()
    let cancelled = false
    let timer = 0
    const tick = async (): Promise<void> => {
      await refreshStatus()
      if (cancelled) return
      timer = window.setTimeout(() => void tick(), runningRef.current ? 1_200 : 5_000)
    }
    timer = window.setTimeout(() => void tick(), 5_000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [load, refreshStatus])

  useEffect(() => {
    if (!settings?.workspaceRoot.trim()) return
    let cancelled = false
    void Promise.all(
      runtime.resourceProviders.map((provider) => provider.loadResources(settings.workspaceRoot))
    ).catch((resourceError) => {
      if (!cancelled) setError(resourceError instanceof Error ? resourceError.message : String(resourceError))
    })
    return () => { cancelled = true }
  }, [runtime.resourceProviders, settings?.workspaceRoot])

  const workflowSettings = settings ? normalizeWorkflowSettings(settings.workflow) : null
  const workflows = workflowSettings?.workflows ?? EMPTY_WORKFLOWS
  const runningIds = useMemo(() => new Set(status?.runningWorkflowIds ?? []), [status])
  const pendingApprovalsByWorkflow = useMemo(() => {
    const grouped = new Map<string, WorkflowPendingApprovalV1[]>()
    for (const approval of status?.pendingApprovals ?? []) {
      const existing = grouped.get(approval.workflowId) ?? []
      existing.push(approval)
      grouped.set(approval.workflowId, existing)
    }
    return grouped
  }, [status])

  // When a run finishes, reload settings so the editor's persisted last-run results refresh.
  const prevRunningCount = useRef(0)
  useEffect(() => {
    const count = runningIds.size
    if (count < prevRunningCount.current) void load()
    prevRunningCount.current = count
  }, [runningIds, load])

  const persist = useCallback(
    async (nextWorkflows: WorkflowV1[]): Promise<void> => {
      if (!settings) return
      const nextWorkflow = mergeWorkflowSettings(settings.workflow, { enabled: true, workflows: nextWorkflows })
      setSettings({ ...settings, workflow: nextWorkflow })
      const saved = await runtime.setSettings({ workflow: nextWorkflow })
      setSettings(saved)
      void refreshStatus()
    },
    [refreshStatus, runtime, settings]
  )

  const [showHooks, setShowHooks] = useState(false)
  const persistHookTriggers = useCallback(
    async (next: WorkflowHookTriggerV1[]): Promise<void> => {
      if (!settings) return
      const nextWorkflow = mergeWorkflowSettings(settings.workflow, { hookTriggers: next })
      setSettings({ ...settings, workflow: nextWorkflow })
      const saved = await runtime.setSettings({ workflow: nextWorkflow })
      setSettings(saved)
    },
    [runtime, settings]
  )

  const handleCreate = useCallback(async (): Promise<void> => {
    const created = createWorkflow(t('workflowUntitled'))
    await persist([...workflows, created])
    setEditingId(created.id)
  }, [persist, t, workflows])

  const openDatasetBuilder = useCallback(async (): Promise<void> => {
    if (!settings || datasetBuilderLoading) return
    setDatasetBuilderLoading(true)
    setError(null)
    try {
      const catalogs = await Promise.all(
        runtime.resourceProviders.map((provider) => provider.loadResources(settings.workspaceRoot))
      )
      const byId = new Map<string, DatasetSourceOption>()
      for (const [providerIndex, resources] of catalogs.entries()) {
        const provider = runtime.resourceProviders[providerIndex]
        if (!provider) continue
        for (const resource of resources) {
          if (resource.role !== 'data-source') continue
          const resourceNode = provider.createNode(resource, { x: 0, y: 0 })
          const binding: NonNullable<CreateDatasetLoopInput['sourceBindings']>[number] = {
            sourceId: resource.id,
            providerId: resourceNode.config.providerId,
            resourceId: resourceNode.config.resourceId,
            resourceName: resourceNode.config.resourceName,
            operationId: resourceNode.config.operationId,
            actionId: resourceNode.config.actionId,
            effect: resourceNode.config.effect,
            inputTemplate: resourceNode.config.inputTemplate
          }
          byId.set(resource.id, { id: resource.id, name: resource.name, binding })
        }
      }
      setDatasetBuilderSources([...byId.values()])
      setDatasetBuilderOpen(true)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setDatasetBuilderLoading(false)
    }
  }, [datasetBuilderLoading, runtime, settings])

  const importInputRef = useRef<HTMLInputElement | null>(null)

  const handleExport = useCallback((workflow: WorkflowV1): void => {
    const text = serializeWorkflowDsl(workflow, 'sciforge', new Date().toISOString())
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(workflow.name || 'workflow').replace(/[^\w.-]+/g, '_') || 'workflow'}.loop.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleImportFile = useCallback(
    async (file: File): Promise<void> => {
      const result = parseWorkflowDsl(await file.text(), new Date().toISOString())
      if (!result.ok) {
        setError(t(`workflowImportError_${result.error}`))
        return
      }
      const existing = new Set(workflows.map((workflow) => workflow.name))
      let name = result.workflow.name || t('workflowUntitled')
      if (existing.has(name)) {
        let suffix = 2
        while (existing.has(`${name} (${suffix})`)) suffix += 1
        name = `${name} (${suffix})`
      }
      const oldId = result.workflow.id
      const newId = `workflow-${crypto.randomUUID()}`
      // Re-point any self-referencing loop / subworkflow node from the old id to the new one.
      const nodes = result.workflow.nodes.map((node): WorkflowNodeV1 => {
        if (node.type === 'subworkflow' && node.config.workflowId === oldId) {
          return { ...node, config: { ...node.config, workflowId: newId } }
        }
        if (node.type === 'loop' && node.config.workflowId === oldId) {
          return { ...node, config: { ...node.config, workflowId: newId } }
        }
        return node
      })
      const imported: WorkflowV1 = { ...result.workflow, id: newId, name, nodes }
      setError(null)
      await persist([...workflows, imported])
      setEditingId(imported.id)
    },
    [persist, t, workflows]
  )

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!window.confirm(t('workflowDeleteConfirm'))) return
      await persist(workflows.filter((workflow) => workflow.id !== id))
    },
    [persist, t, workflows]
  )

  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      await persist(
        workflows.map((workflow) =>
          workflow.id === id ? { ...workflow, enabled, updatedAt: new Date().toISOString() } : workflow
        )
      )
    },
    [persist, workflows]
  )

  const handleToggleCallable = useCallback(
    async (id: string, callableByAgent: boolean): Promise<void> => {
      await persist(
        workflows.map((workflow) =>
          workflow.id === id ? { ...workflow, callableByAgent, updatedAt: new Date().toISOString() } : workflow
        )
      )
    },
    [persist, workflows]
  )

  const handleRun = useCallback(
    async (id: string, input?: Record<string, unknown>): Promise<void> => {
      const result = await runtime.runWorkflow(id, input)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError(null)
      void refreshStatus()
    },
    [refreshStatus, runtime]
  )

  // When a workflow's manual trigger defines a typed input schema, collect values first.
  const requestRun = useCallback(
    (workflow: WorkflowV1): void => {
      const trigger = workflow.nodes.find((node) => node.type === 'manual-trigger')
      const schema = trigger && trigger.type === 'manual-trigger' ? trigger.config.inputSchema ?? [] : []
      if (schema.length > 0) setRunInputTarget(workflow)
      else void handleRun(workflow.id)
    },
    [handleRun]
  )

  const handleStop = useCallback(
    async (id: string): Promise<void> => {
      await runtime.stopWorkflow(id)
      void refreshStatus()
    },
    [refreshStatus, runtime]
  )

  const handleResolveApproval = useCallback(
    async (token: string, decision: WorkflowApprovalDecision): Promise<void> => {
      const result = await runtime.resolveWorkflowApproval(token, decision)
      if (!result.ok) setError(t('workflowApprovalResolveFailed'))
      else setError(null)
      void refreshStatus()
    },
    [refreshStatus, runtime, t]
  )

  const handleRunNode = useCallback(
    async (workflowId: string, nodeId: string): Promise<void> => {
      const result = await runtime.runWorkflowNode(workflowId, nodeId)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError(null)
      void refreshStatus()
    },
    [refreshStatus, runtime]
  )

  const handleEditorPersist = useCallback(
    async (patch: {
      name: string
      enabled: boolean
      env: WorkflowV1['env']
      nodes: WorkflowNodeV1[]
      connections: WorkflowV1['connections']
    }): Promise<void> => {
      if (!editingId) return
      await persist(
        workflows.map((workflow) =>
          workflow.id === editingId
            ? { ...workflow, ...patch, updatedAt: new Date().toISOString() }
            : workflow
        )
      )
    },
    [editingId, persist, workflows]
  )

  const editingWorkflow = editingId ? workflows.find((workflow) => workflow.id === editingId) ?? null : null

  if (editingWorkflow && settings) {
    const lastRun = editingWorkflow.runs[editingWorkflow.runs.length - 1]
    const lastResults: Record<string, WorkflowNodeRunResultV1> = {}
    if (lastRun) {
      for (const result of lastRun.nodeResults) lastResults[result.nodeId] = result
    }
    return (
      <>
        <WorkflowEditorView
          key={editingWorkflow.id}
          workflow={editingWorkflow}
          settings={settings}
          resourceProviders={runtime.resourceProviders}
          runStatus={status?.nodeStatus?.[editingWorkflow.id] ?? {}}
          lastResults={lastResults}
          liveResults={status?.nodeResults?.[editingWorkflow.id] ?? {}}
          running={runningIds.has(editingWorkflow.id)}
          onPersist={handleEditorPersist}
          onRun={() => requestRun(editingWorkflow)}
          onRunNode={(nodeId) => handleRunNode(editingWorkflow.id, nodeId)}
          onStop={() => handleStop(editingWorkflow.id)}
          onBack={() => setEditingId(null)}
        />
        {runInputTarget ? (
          <RunInputDialog
            workflow={runInputTarget}
            onClose={() => setRunInputTarget(null)}
            onRun={(input) => {
              const id = runInputTarget.id
              setRunInputTarget(null)
              void handleRun(id, input)
            }}
          />
        ) : null}
      </>
    )
  }

  return (
    <div className="ds-no-drag flex h-full min-h-0 flex-col bg-ds-sidebar">
      <header className="flex shrink-0 items-center gap-2 border-b border-ds-border bg-ds-sidebar px-3 py-2.5">
        <WorkflowIcon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[13px] font-semibold text-ds-ink">{t('workflow')}</h1>
          <p className="truncate text-[10.5px] text-ds-faint">{t('workflowChatHint')}</p>
        </div>
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        ) : null}
      </header>

      <main className="ds-no-drag min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        <div className="mx-auto flex w-full max-w-none flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] leading-6 text-ds-faint">{t('workflowSubtitle')}</p>
            <div className="flex items-center gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void handleImportFile(file)
                }}
              />
              <button
                type="button"
                disabled={!settings || datasetBuilderLoading}
                onClick={() => void openDatasetBuilder()}
                className="inline-flex items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3.5 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
              >
                <Database className="h-4 w-4" strokeWidth={1.8} />
                {datasetBuilderLoading ? t('workflowDatasetLoading') : t('workflowBuildDataset')}
              </button>
              <button
                type="button"
                onClick={() => setShowHooks(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3.5 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <Zap className="h-4 w-4" strokeWidth={1.8} />
                {t('workflowHooks')}
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl border border-ds-border bg-ds-card px-3.5 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <Upload className="h-4 w-4" strokeWidth={1.8} />
                {t('workflowImport')}
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                {t('workflowNew')}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-700 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-[13px] text-ds-faint">{t('loading')}</p>
          ) : workflows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ds-border px-6 py-16 text-center">
              <WorkflowIcon className="h-8 w-8 text-ds-faint" strokeWidth={1.5} />
              <p className="text-[14px] font-medium text-ds-ink">{t('workflowEmpty')}</p>
              <p className="max-w-[360px] text-[13px] text-ds-faint">{t('workflowEmptyHint')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {workflows.map((workflow) => {
                const running = runningIds.has(workflow.id)
                const lastStatus: WorkflowV1['lastStatus'] = running ? 'running' : workflow.lastStatus
                const pendingApprovals = pendingApprovalsByWorkflow.get(workflow.id) ?? []
                return (
                  <div
                    key={workflow.id}
                    className="flex flex-col gap-3 rounded-2xl border border-ds-border bg-ds-card px-4 py-3.5 shadow-sm"
                  >
                    {/* Title + status + the row's real actions (run / export / edit / delete). */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                            <WorkflowIcon className="h-4 w-4" strokeWidth={1.9} />
                          </span>
                          <h3 className="truncate text-[15px] font-semibold text-ds-ink">
                            {workflow.name || t('workflowUntitled')}
                          </h3>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(lastStatus)}`}>
                            {t(`workflowStatus_${lastStatus}`)}
                          </span>
                        </div>
                        <p className="mt-1 pl-9 text-[12px] text-ds-faint">
                          {t('workflowNodeCount', { count: workflow.nodes.length })} ·{' '}
                          {t('workflowLastRun')}: {formatDateTime(workflow.lastRunAt, t('workflowNeverRun'))}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => (running ? void handleStop(workflow.id) : requestRun(workflow))}
                          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition ${
                            running
                              ? 'bg-red-500/90 text-white hover:bg-red-500'
                              : 'bg-ds-userbubble text-ds-userbubbleFg shadow-sm hover:opacity-90'
                          }`}
                        >
                          {running ? <Square className="h-3.5 w-3.5" strokeWidth={2.2} /> : <Play className="h-3.5 w-3.5" strokeWidth={2} />}
                          {running ? t('workflowStop') : t('workflowRunNow')}
                        </button>
                        <span className="mx-0.5 h-5 w-px bg-ds-border" />
                        <button
                          type="button"
                          onClick={() => setEditingId(workflow.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          title={t('workflowEdit')}
                          aria-label={t('workflowEdit')}
                        >
                          <Pencil className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport(workflow)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                          title={t('workflowExport')}
                          aria-label={t('workflowExport')}
                        >
                          <Download className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(workflow.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                          title={t('workflowDelete')}
                          aria-label={t('workflowDelete')}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>

                    {workflow.lastMessage.trim() ? (
                      <p className="rounded-lg bg-ds-subtle px-3 py-2 text-[12.5px] text-ds-muted">
                        <span className="font-medium text-ds-faint">{t('workflowLastResult')}: </span>
                        {workflow.lastMessage.length > 240
                          ? `${workflow.lastMessage.slice(0, 240)}…`
                          : workflow.lastMessage}
                      </p>
                    ) : null}

                    {pendingApprovals.length > 0 ? (
                      <div className="flex flex-col gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-3">
                        {pendingApprovals.map((approval) => (
                          <div key={approval.token} className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <UserCheck className="h-4 w-4 shrink-0 text-amber-600" strokeWidth={1.9} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12.5px] font-semibold text-ds-ink">
                                  {approval.title || t('workflowApprovalPending')}
                                </div>
                                <div className="text-[11.5px] text-ds-faint">
                                  {approval.nodeName || t('workflowNode_human-approval')}
                                </div>
                              </div>
                            </div>
                            {approval.instruction ? (
                              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[12px] leading-5 text-ds-muted">
                                {approval.instruction}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleResolveApproval(approval.token, 'approved')}
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/90 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-emerald-500"
                              >
                                <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                                {t('workflowApprovalApprove')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleResolveApproval(approval.token, 'rejected')}
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 py-1.5 text-[12.5px] font-semibold text-red-600 transition hover:bg-red-500/10"
                              >
                                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                                {t('workflowApprovalReject')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* State switches — kept visually distinct from the actions above. */}
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-ds-border pt-2.5">
                      <WorkflowToggle
                        on={workflow.enabled}
                        onClick={() => void handleToggleEnabled(workflow.id, !workflow.enabled)}
                        label={t('workflowEnableShort')}
                        title={t('workflowEnableHint')}
                        icon={<Power className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      />
                      <WorkflowToggle
                        on={workflow.callableByAgent}
                        disabled={!workflow.enabled}
                        onClick={() => void handleToggleCallable(workflow.id, !workflow.callableByAgent)}
                        label={t('workflowCallableShort')}
                        title={workflow.enabled ? t('workflowCallableHint') : t('workflowCallableNeedsEnable')}
                        icon={<Bot className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {runInputTarget ? (
        <RunInputDialog
          workflow={runInputTarget}
          onClose={() => setRunInputTarget(null)}
          onRun={(input) => {
            const id = runInputTarget.id
            setRunInputTarget(null)
            void handleRun(id, input)
          }}
        />
      ) : null}

      {showHooks && settings ? (
        <WorkflowHookTriggers
          triggers={settings.workflow.hookTriggers}
          workflows={workflows}
          onChange={(next) => void persistHookTriggers(next)}
          onClose={() => setShowHooks(false)}
        />
      ) : null}

      {datasetBuilderOpen ? (
        <DatasetLoopDialog
          sources={datasetBuilderSources}
          onClose={() => setDatasetBuilderOpen(false)}
          onSubmit={async (input) => {
            const result = await runtime.buildDataset(input)
            setDatasetBuilderOpen(false)
            await load()
            setEditingId(result.workflowId)
          }}
        />
      ) : null}
    </div>
  )
}

/** A labelled on/off switch for a workflow's state flags (enabled / AI-callable). */
function WorkflowToggle({
  on,
  onClick,
  label,
  title,
  icon,
  disabled = false
}: {
  on: boolean
  onClick: () => void
  label: string
  title?: string
  icon: ReactElement
  disabled?: boolean
}): ReactElement {
  const active = on && !disabled
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-2 rounded-lg px-2 py-1 transition ${
        disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-ds-hover'
      }`}
    >
      <span
        className={`flex h-[18px] w-8 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          active ? 'bg-accent' : 'bg-ds-border'
        }`}
      >
        <span
          className={`h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
            on ? 'translate-x-[14px]' : 'translate-x-0'
          }`}
        />
      </span>
      <span className={`flex items-center gap-1 text-[12.5px] font-medium ${active ? 'text-ds-ink' : 'text-ds-muted'}`}>
        {icon}
        {label}
      </span>
    </button>
  )
}

const RUN_INPUT_FIELD =
  'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25'

/** Generated form that collects a manual trigger's typed inputs before a one-off run. */
function RunInputDialog({
  workflow,
  onRun,
  onClose
}: {
  workflow: WorkflowV1
  onRun: (input: Record<string, unknown>) => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const trigger = workflow.nodes.find((node) => node.type === 'manual-trigger')
  const schema: WorkflowInputFieldV1[] = trigger && trigger.type === 'manual-trigger' ? trigger.config.inputSchema ?? [] : []
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const field of schema) initial[field.key] = field.type === 'boolean' ? field.defaultValue === 'true' : field.defaultValue
    return initial
  })
  const set = (key: string, value: unknown): void => setValues((prev) => ({ ...prev, [key]: value }))
  const missing = schema.some((field) => {
    if (!field.required) return false
    const value = values[field.key]
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  })

  return (
    <div className="ds-no-drag fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-[460px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ds-border px-5 py-3.5">
          <span className="text-[14px] font-semibold text-ds-ink">{t('workflowRunWithInputs')}</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </header>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          {schema.map((field) => (
            <label key={field.key} className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ds-muted">
                {field.label.trim() || field.key}
                {field.required ? <span className="ml-1 text-red-500">*</span> : null}
              </span>
              {field.description ? <span className="text-[11px] text-ds-faint">{field.description}</span> : null}
              {field.type === 'boolean' ? (
                <input
                  type="checkbox"
                  className="h-4 w-4 self-start"
                  checked={Boolean(values[field.key])}
                  onChange={(event) => set(field.key, event.target.checked)}
                />
              ) : field.type === 'paragraph' || field.type === 'json' ? (
                <textarea
                  className={`${RUN_INPUT_FIELD} min-h-[80px] resize-y ${field.type === 'json' ? 'font-mono text-[12px]' : ''}`}
                  value={String(values[field.key] ?? '')}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              ) : field.type === 'select' ? (
                <select
                  className={RUN_INPUT_FIELD}
                  value={String(values[field.key] ?? '')}
                  onChange={(event) => set(field.key, event.target.value)}
                >
                  <option value="" />
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  className={RUN_INPUT_FIELD}
                  value={String(values[field.key] ?? '')}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
        <footer className="flex justify-end gap-2 border-t border-ds-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-xl border border-ds-border bg-ds-card px-4 py-2 text-[13px] font-medium text-ds-muted transition hover:bg-ds-hover"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={missing}
            onClick={() => onRun(values)}
            className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-4 w-4" strokeWidth={2} />
            {t('workflowRunNow')}
          </button>
        </footer>
      </div>
    </div>
  )
}
