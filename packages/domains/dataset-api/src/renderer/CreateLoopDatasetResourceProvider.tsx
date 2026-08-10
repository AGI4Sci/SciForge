import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Braces, Database, FileDown, ListChecks, Loader2, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { z } from 'zod'
import type { DomainRendererCapabilityInvoker } from '@sciforge/domain-sdk/host'
import type {
  CreateLoopResourceDescriptor,
  CreateLoopResourceNode,
  CreateLoopResourceProvider
} from '@sciforge/domain-create-loop/resource-provider'
import {
  DATASET_API_CAPABILITY_IDS,
  datasetApiCapabilityOutputSchema,
  datasetConfirmPlanInputSchema,
  datasetApiEnsureProvidersInputSchema,
  datasetApiListInputSchema
} from '../contract.js'

export const DATASET_API_CREATE_LOOP_RESOURCE_PROVIDER_ID = 'dataset-api' as const

const jsonRecordSchema = z.record(z.string(), z.json())
const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  baseUrl: z.string(),
  metadataEndpoint: z.string(),
  rawDataEndpoint: z.string(),
  usageExamples: z.object({
    metadata: jsonRecordSchema,
    rawData: jsonRecordSchema
  }).optional()
})
const listResultSchema = z.object({ sources: z.array(sourceSchema) })
const confirmedPlanResultSchema = z.object({
  planId: z.string(),
  status: z.literal('confirmed')
})

type JsonValue = z.infer<ReturnType<typeof z.json>>
type DatasetSourceResourceData = Readonly<{
  kind: 'source'
  baseUrl: string
  metadataEndpoint: string
  rawDataEndpoint: string
  metadataInput: Record<string, JsonValue>
  rawDataInput: Record<string, JsonValue>
}>
type DatasetPlanResourceData = Readonly<{ kind: 'plan' }>
type DatasetQueryResourceData = Readonly<{
  kind: 'query'
  sourceId: string
  sourceName: string
  source: DatasetSourceResourceData
}>
type DatasetResourceData = DatasetSourceResourceData | DatasetPlanResourceData | DatasetQueryResourceData

const DATASET_PLAN_RESOURCE_ID = 'dataset-processing-plan'
const DATASET_QUERY_RESOURCE_ID = 'dataset-query'
const DATASET_QUERY_NODE_NAME = 'Query dataset'
type DatasetPlanOperation = 'prepare-plan' | 'execute-plan' | 'resume-plan'

const listContract = Object.freeze({
  actionId: DATASET_API_CAPABILITY_IDS.list,
  effect: 'read' as const,
  inputSchema: datasetApiListInputSchema.omit({ workspaceRoot: true }),
  outputSchema: datasetApiCapabilityOutputSchema
})
const ensureProvidersContract = Object.freeze({
  actionId: DATASET_API_CAPABILITY_IDS.ensureProviders,
  effect: 'workspace-write' as const,
  inputSchema: datasetApiEnsureProvidersInputSchema.omit({ workspaceRoot: true }),
  outputSchema: datasetApiCapabilityOutputSchema
})
const confirmPlanContract = Object.freeze({
  actionId: DATASET_API_CAPABILITY_IDS.confirmPlan,
  effect: 'external-write' as const,
  inputSchema: datasetConfirmPlanInputSchema.omit({ workspaceRoot: true }),
  outputSchema: datasetApiCapabilityOutputSchema
})

function nodeId(): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
  return `node-${value}`
}

function prettyJson(value: Record<string, JsonValue>): string {
  return JSON.stringify(value, null, 2)
}

function metadataInput(
  resourceId: string,
  example?: Record<string, JsonValue>
): Record<string, JsonValue> {
  return {
    sourceId: resourceId,
    responseMode: 'summary',
    outputFileName: `${resourceId}-metadata.json`,
    ...example
  }
}

function rawDataInput(
  resourceId: string,
  example?: Record<string, JsonValue>
): Record<string, JsonValue> {
  return {
    sourceId: resourceId,
    outputFileName: `${resourceId}-raw-data.bin`,
    expectedFormat: 'auto',
    overwrite: true,
    ...example
  }
}

function descriptorData(resource: CreateLoopResourceDescriptor): DatasetResourceData | null {
  if (!resource.data || typeof resource.data !== 'object' || Array.isArray(resource.data)) return null
  const data = resource.data as Record<string, unknown>
  if (data.kind === 'plan') return data as DatasetPlanResourceData
  if (data.kind === 'query') return data as unknown as DatasetQueryResourceData
  if (data.kind !== 'source') return null
  if (typeof data.baseUrl !== 'string' || typeof data.metadataEndpoint !== 'string' ||
      typeof data.rawDataEndpoint !== 'string') return null
  return data as DatasetSourceResourceData
}

function sourceData(resource: CreateLoopResourceDescriptor): DatasetSourceResourceData | null {
  const data = descriptorData(resource)
  return data?.kind === 'source' ? data : null
}

function planTemplate(operation: DatasetPlanOperation): Record<string, JsonValue> {
  if (operation === 'execute-plan') return { planId: '{{json.datasetApi.result.planId}}' }
  if (operation === 'resume-plan') {
    return {
      planId: '{{json.datasetApi.result.execution.planId}}',
      runId: '{{json.datasetApi.result.execution.runId}}'
    }
  }
  return {
    objective: 'Profile and validate a workspace dataset artifact.',
    operations: [{
      tool: 'dataset_profile',
      description: 'Profile the input dataset artifact.',
      parameters: { inputArtifact: 'data/input.json' }
    }],
    outputs: [{ name: 'profile.json', format: 'json' }]
  }
}

function planAction(operation: DatasetPlanOperation): string {
  if (operation === 'execute-plan') return DATASET_API_CAPABILITY_IDS.executePlan
  if (operation === 'resume-plan') return DATASET_API_CAPABILITY_IDS.resumePlan
  return DATASET_API_CAPABILITY_IDS.preparePlan
}

export async function confirmDatasetPlan(
  invoker: DomainRendererCapabilityInvoker,
  workspaceRoot: string,
  planId: string
): Promise<{ planId: string; status: 'confirmed' }> {
  const output = await invoker.invoke(
    confirmPlanContract,
    { planId },
    {
      workspaceId: workspaceRoot,
      approval: { mode: 'confirmation' }
    }
  )
  return confirmedPlanResultSchema.parse(output.datasetApi.result)
}

export function createDatasetApiCreateLoopResourceProvider(
  invoker: DomainRendererCapabilityInvoker
): CreateLoopResourceProvider {
  const cache = new Map<string, readonly CreateLoopResourceDescriptor[]>()

  const loadResources = async (workspaceRoot: string): Promise<readonly CreateLoopResourceDescriptor[]> => {
    if (!workspaceRoot.trim()) return []
    await invoker.invoke(ensureProvidersContract, {}, { workspaceId: workspaceRoot })
    const listOutput = await invoker.invoke(listContract, {}, { workspaceId: workspaceRoot })
    const listResult = listResultSchema.parse(listOutput.datasetApi.result)
    const registered = Object.freeze(listResult.sources.map((source): CreateLoopResourceDescriptor => {
      const metadata = metadataInput(source.id, source.usageExamples?.metadata)
      const rawData = rawDataInput(source.id, source.usageExamples?.rawData)
      return Object.freeze({
        id: source.id,
        name: source.name,
        description: source.description,
        detail: source.baseUrl,
        role: 'data-source',
        paletteVisibility: 'hidden',
        data: {
          kind: 'source',
          baseUrl: source.baseUrl,
          metadataEndpoint: source.metadataEndpoint,
          rawDataEndpoint: source.rawDataEndpoint,
          metadataInput: metadata,
          rawDataInput: rawData
        }
      })
    }))
    const defaultSource = registered[0]
    const defaultSourceData = defaultSource ? sourceData(defaultSource) : null
    const queryResource: CreateLoopResourceDescriptor | null = defaultSource && defaultSourceData
      ? Object.freeze({
          id: DATASET_QUERY_RESOURCE_ID,
          name: DATASET_QUERY_NODE_NAME,
          nameKey: 'datasetResourceQuery',
          description: 'Query metadata or raw data from any registered Dataset API source.',
          detail: 'metadata · raw data',
          role: 'operation',
          data: {
            kind: 'query',
            sourceId: defaultSource.id,
            sourceName: defaultSource.name,
            source: defaultSourceData
          }
        })
      : null
    const planResource: CreateLoopResourceDescriptor = Object.freeze({
      id: DATASET_PLAN_RESOURCE_ID,
      name: 'Dataset processing plan',
      description: 'Prepare, execute, or resume an immutable data-processing plan with checkpoints.',
      detail: 'prepare · execute · resume',
      role: 'operation',
      data: { kind: 'plan' }
    })
    const resources = Object.freeze([
      ...registered,
      ...(queryResource ? [queryResource] : []),
      planResource
    ])
    cache.set(workspaceRoot, resources)
    return resources
  }

  return Object.freeze({
    id: DATASET_API_CREATE_LOOP_RESOURCE_PROVIDER_ID,
    title: 'Dataset API',
    loadResources,
    createNode: (resource, position): CreateLoopResourceNode => {
      const operation: DatasetPlanOperation = 'prepare-plan'
      const data = descriptorData(resource)
      const plan = data?.kind === 'plan'
      const query = data?.kind === 'query' ? data : null
      const selectedResourceId = query?.sourceId ?? resource.id
      const selectedResourceName = query?.sourceName ?? resource.name
      return {
        id: nodeId(),
        type: 'resource',
        name: resource.name,
        position: { ...position },
        disabled: false,
        config: {
          providerId: DATASET_API_CREATE_LOOP_RESOURCE_PROVIDER_ID,
          resourceId: selectedResourceId,
          resourceName: selectedResourceName,
          operationId: plan ? operation : 'metadata',
          actionId: plan ? planAction(operation) : DATASET_API_CAPABILITY_IDS.metadata,
          effect: 'workspace-write',
          inputTemplate: prettyJson(
            plan
              ? planTemplate(operation)
              : query?.source.metadataInput ?? sourceData(resource)?.metadataInput ?? metadataInput(resource.id)
          )
        }
      }
    },
    renderNodeConfig: (context) => (
      <DatasetResourceNodeConfig
        {...context}
        invoker={invoker}
        initialResources={cache.get(context.workspaceRoot) ?? []}
        loadResources={loadResources}
      />
    )
  })
}

function DatasetResourceNodeConfig({
  node,
  workspaceRoot,
  lastResult,
  onChange,
  invoker,
  initialResources,
  loadResources
}: Readonly<{
  node: CreateLoopResourceNode
  workspaceRoot: string
  lastResult: import('@sciforge/domain-create-loop/contract').WorkflowNodeRunResultV1 | null
  onChange: (node: CreateLoopResourceNode) => void
  invoker: DomainRendererCapabilityInvoker
  initialResources: readonly CreateLoopResourceDescriptor[]
  loadResources: (workspaceRoot: string) => Promise<readonly CreateLoopResourceDescriptor[]>
}>): ReactElement {
  const { t } = useTranslation('common')
  const [resources, setResources] = useState(
    initialResources.filter((resource) => (
      resource.role !== 'operation'
    ))
  )
  const resource = resources.find((item) => item.id === node.config.resourceId)

  useEffect(() => {
    if (!workspaceRoot.trim()) return
    let cancelled = false
    void loadResources(workspaceRoot).then((items) => {
      if (!cancelled) {
        setResources(items.filter((resource) => (
          resource.role !== 'operation'
        )))
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [loadResources, workspaceRoot])

  if (node.config.resourceId === DATASET_PLAN_RESOURCE_ID) {
    return (
      <DatasetPlanNodeConfig
        node={node}
        workspaceRoot={workspaceRoot}
        lastResult={lastResult}
        invoker={invoker}
        onChange={onChange}
      />
    )
  }

  const data = resource ? sourceData(resource) : null
  const rawData = node.config.operationId === 'raw-data'
  const selectOperation = (nextRawData: boolean): void => {
    onChange({
      ...node,
      config: {
        ...node.config,
        operationId: nextRawData ? 'raw-data' : 'metadata',
        actionId: nextRawData ? DATASET_API_CAPABILITY_IDS.rawData : DATASET_API_CAPABILITY_IDS.metadata,
        effect: 'workspace-write',
        inputTemplate: prettyJson(
          nextRawData
            ? data?.rawDataInput ?? rawDataInput(node.config.resourceId)
            : data?.metadataInput ?? metadataInput(node.config.resourceId)
        )
      }
    })
  }

  const selectResource = (resourceId: string): void => {
    const nextResource = resources.find((item) => item.id === resourceId)
    if (!nextResource) return
    const nextData = sourceData(nextResource)
    onChange({
      ...node,
      name: node.name === DATASET_QUERY_NODE_NAME || node.name === t('datasetResourceQuery')
        ? node.name
        : nextResource.name,
      config: {
        ...node.config,
        resourceId: nextResource.id,
        resourceName: nextResource.name,
        inputTemplate: prettyJson(
          rawData
            ? nextData?.rawDataInput ?? rawDataInput(nextResource.id)
            : nextData?.metadataInput ?? metadataInput(nextResource.id)
        )
      }
    })
  }

  const endpoint = data
    ? displayEndpoint(data.baseUrl, rawData ? data.rawDataEndpoint : data.metadataEndpoint)
    : ''

  return (
    <div className="flex flex-col gap-4 border-t border-ds-border pt-3">
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
          <Database className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold text-ds-ink">{node.config.resourceName}</span>
          <span className="block truncate text-[11px] text-ds-faint">{node.config.resourceId}</span>
        </span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ds-muted">{t('datasetResourceDataset')}</span>
        <select
          className="w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
          value={node.config.resourceId}
          onChange={(event) => selectResource(event.target.value)}
        >
          {!resource ? <option value={node.config.resourceId}>{node.config.resourceName}</option> : null}
          {resources.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-1 rounded-md bg-ds-subtle p-1">
        <OperationButton
          active={!rawData}
          icon={<Braces className="h-3.5 w-3.5" />}
          label={t('datasetResourceMetadata')}
          onClick={() => selectOperation(false)}
        />
        <OperationButton
          active={rawData}
          icon={<FileDown className="h-3.5 w-3.5" />}
          label={t('datasetResourceRawData')}
          onClick={() => selectOperation(true)}
        />
      </div>

      {endpoint ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ds-muted">{t('datasetResourceEndpoint')}</span>
          <code className="break-all rounded-md bg-ds-subtle px-2.5 py-2 text-[10.5px] leading-4 text-ds-muted">
            {endpoint}
          </code>
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ds-muted">{t('datasetResourceRequest')}</span>
        <textarea
          className="min-h-48 w-full resize-y rounded-lg border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
          spellCheck={false}
          value={node.config.inputTemplate}
          onChange={(event) => onChange({
            ...node,
            config: { ...node.config, inputTemplate: event.target.value }
          })}
        />
        <span className="text-[11px] leading-4 text-ds-faint">{t('datasetResourceRequestHint')}</span>
      </label>
    </div>
  )
}

function DatasetPlanNodeConfig({
  node,
  workspaceRoot,
  lastResult,
  invoker,
  onChange
}: Readonly<{
  node: CreateLoopResourceNode
  workspaceRoot: string
  lastResult: import('@sciforge/domain-create-loop/contract').WorkflowNodeRunResultV1 | null
  invoker: DomainRendererCapabilityInvoker
  onChange: (node: CreateLoopResourceNode) => void
}>): ReactElement {
  const { t } = useTranslation('common')
  const [confirming, setConfirming] = useState(false)
  const [confirmedPlanId, setConfirmedPlanId] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)
  const operation = (
    ['prepare-plan', 'execute-plan', 'resume-plan'].includes(node.config.operationId)
      ? node.config.operationId
      : 'prepare-plan'
  ) as DatasetPlanOperation
  const draft = readDatasetPlanDraft(lastResult?.outputJson)
  const receipt = readDatasetExecutionReceipt(lastResult?.outputJson)

  useEffect(() => {
    setConfirmedPlanId(null)
    setConfirmationError(null)
  }, [draft?.planId])

  const selectOperation = (next: DatasetPlanOperation, input = planTemplate(next)): void => {
    onChange({
      ...node,
      config: {
        ...node.config,
        operationId: next,
        actionId: planAction(next),
        effect: 'workspace-write',
        inputTemplate: prettyJson(input)
      }
    })
  }

  const confirmDraft = async (): Promise<void> => {
    if (!draft || confirming) return
    setConfirming(true)
    setConfirmationError(null)
    try {
      const confirmed = await confirmDatasetPlan(invoker, workspaceRoot, draft.planId)
      setConfirmedPlanId(confirmed.planId)
      selectOperation('execute-plan', { planId: confirmed.planId })
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : String(error))
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-ds-border pt-3">
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-600">
          <ListChecks className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold text-ds-ink">{t('datasetPlanName')}</span>
          <span className="block text-[11px] text-ds-faint">{t('datasetPlanDurableHint')}</span>
        </span>
      </div>

      {draft && operation === 'prepare-plan' ? (
        <div className="rounded-md border border-ds-border bg-ds-subtle px-3 py-2 text-[11.5px] leading-5 text-ds-muted">
          <div className="font-medium text-ds-ink">{t('datasetPlanDraftReady')}</div>
          <div className="break-all">{draft.planId}</div>
          <button
            type="button"
            disabled={confirming}
            className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-ds-border bg-ds-card px-2.5 py-1 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:cursor-wait disabled:opacity-60"
            onClick={() => void confirmDraft()}
          >
            {confirming
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ShieldCheck className="h-3.5 w-3.5" />}
            {confirming ? t('datasetPlanConfirming') : t('datasetPlanConfirm')}
          </button>
        </div>
      ) : null}

      {confirmedPlanId ? (
        <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-[11.5px] leading-5 text-emerald-700">
          {t('datasetPlanConfirmed')} <span className="break-all font-mono">{confirmedPlanId}</span>
        </div>
      ) : null}

      {confirmationError ? (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-[11.5px] leading-5 text-red-700">
          {confirmationError}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-1 rounded-md bg-ds-subtle p-1">
        <OperationButton
          active={operation === 'prepare-plan'}
          icon={<ListChecks className="h-3.5 w-3.5" />}
          label={t('datasetPlanPrepare')}
          onClick={() => selectOperation('prepare-plan')}
        />
        <OperationButton
          active={operation === 'execute-plan'}
          icon={<Play className="h-3.5 w-3.5" />}
          label={t('datasetPlanExecute')}
          onClick={() => selectOperation('execute-plan')}
        />
        <OperationButton
          active={operation === 'resume-plan'}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label={t('datasetPlanResume')}
          onClick={() => selectOperation('resume-plan')}
        />
      </div>

      {receipt ? (
        <div className="rounded-md border border-ds-border bg-ds-subtle px-3 py-2 text-[11.5px] leading-5 text-ds-muted">
          <div className="font-medium text-ds-ink">
            {t('datasetPlanProgress', { completed: receipt.completed, total: receipt.total })}
          </div>
          <div className="break-all">{receipt.planId} · {receipt.runId}</div>
          {receipt.failed ? (
            <button
              type="button"
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-ds-border bg-ds-card px-2.5 py-1 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover"
              onClick={() => selectOperation('resume-plan', {
                planId: receipt.planId,
                runId: receipt.runId
              })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('datasetPlanUseResume')}
            </button>
          ) : null}
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ds-muted">{t('datasetResourceRequest')}</span>
        <textarea
          className="min-h-64 w-full resize-y rounded-lg border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] leading-5 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
          spellCheck={false}
          value={node.config.inputTemplate}
          onChange={(event) => onChange({
            ...node,
            config: { ...node.config, inputTemplate: event.target.value }
          })}
        />
        <span className="text-[11px] leading-4 text-ds-faint">{t('datasetPlanRequestHint')}</span>
      </label>
    </div>
  )
}

export function readDatasetPlanDraft(outputJson?: string): {
  planId: string
  status: 'draft'
} | null {
  if (!outputJson?.trim()) return null
  try {
    const output = JSON.parse(outputJson) as Record<string, unknown>
    const datasetApi = output.datasetApi as Record<string, unknown> | undefined
    const result = datasetApi?.result as Record<string, unknown> | undefined
    if (typeof result?.planId !== 'string' || result.status !== 'draft') return null
    return { planId: result.planId, status: 'draft' }
  } catch {
    return null
  }
}

export function readDatasetExecutionReceipt(outputJson?: string): {
  planId: string
  runId: string
  completed: number
  total: number
  failed: boolean
} | null {
  if (!outputJson?.trim()) return null
  try {
    const output = JSON.parse(outputJson) as Record<string, unknown>
    const datasetApi = output.datasetApi as Record<string, unknown> | undefined
    const result = datasetApi?.result as Record<string, unknown> | undefined
    const execution = (result?.execution ?? result) as Record<string, unknown> | undefined
    if (!execution || typeof execution.planId !== 'string' || typeof execution.runId !== 'string') return null
    const steps = Array.isArray(execution.steps) ? execution.steps : []
    const completed = typeof execution.completedSteps === 'number'
      ? execution.completedSteps
      : steps.filter((step) => (
          !!step && typeof step === 'object' && (step as Record<string, unknown>).status === 'succeeded'
        )).length
    const total = typeof execution.totalSteps === 'number' ? execution.totalSteps : steps.length
    const failedSteps = typeof execution.failedSteps === 'number' ? execution.failedSteps : 0
    return {
      planId: execution.planId,
      runId: execution.runId,
      completed,
      total,
      failed: execution.status === 'failed' || failedSteps > 0 || steps.some((step) => (
        !!step && typeof step === 'object' && (step as Record<string, unknown>).status === 'failed'
      ))
    }
  } catch {
    return null
  }
}

function displayEndpoint(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  return `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

function OperationButton({
  active,
  icon,
  label,
  onClick
}: Readonly<{
  active: boolean
  icon: ReactElement
  label: string
  onClick: () => void
}>): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded px-2 text-[11.5px] font-medium transition ${
        active ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-faint hover:text-ds-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
