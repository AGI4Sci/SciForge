import { z } from 'zod'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk'
import {
  reproOutputComparatorSchema,
  sciforgeReproSpecSchema,
  type SciForgeReproSpecV1
} from '@sciforge/domain-sdk/reproducibility'

export type ScheduleKind = 'manual' | 'interval' | 'daily' | 'at'
export type ScheduleRunMode = 'agent' | 'plan'
export type ScheduleReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'
export type AgentRuntimeId = 'sciforge' | 'codex' | 'claude'
export const SCHEDULE_REASONING_EFFORT_IDS = ['off', 'low', 'medium', 'high', 'max'] as const

export function listModelRouterModelIds(settings: {
  workflow: { model: string }
}): string[] {
  const model = settings.workflow.model.trim()
  return model ? [model] : []
}

export type WorkflowNodeKind =
  | 'manual-trigger'
  | 'schedule-trigger'
  | 'webhook-trigger'
  | 'llm'
  | 'ai-agent'
  | 'generate-image'
  | 'condition'
  | 'switch'
  | 'filter'
  | 'set-fields'
  | 'code'
  | 'sort'
  | 'limit'
  | 'aggregate'
  | 'research-search'
  | 'paper-download'
  | 'http-request'
  | 'merge'
  | 'subworkflow'
  | 'loop'
  | 'delay'
  | 'template'
  | 'json'
  | 'output'
  | 'parameter-extractor'
  | 'question-classifier'
  | 'human-approval'
  | 'custom'

export const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = [
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
  'human-approval',
  'custom'
]

export type WorkflowRunStatus = 'idle' | 'running' | 'success' | 'error'
export type WorkflowNodeRunStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'
/** Runtime-validated by the shared lowercase sha256 schema at every portable boundary. */
export type WorkflowFingerprint = string

/** Schedule trigger extends the scheduled-task schedule kinds with cron. */
export type WorkflowTriggerScheduleKind = ScheduleKind | 'cron'

export type WorkflowScheduleV1 = {
  kind: WorkflowTriggerScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
  /** Cron expression, used when kind === 'cron'. */
  cron: string
}

export type WorkflowConditionOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export type WorkflowHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type WorkflowResearchIntent = 'overview' | 'latest' | 'baseline' | 'sota' | 'dataset' | 'code' | 'gap'
export type WorkflowResearchDomain =
  | 'ai4s'
  | 'biology'
  | 'chemistry'
  | 'materials'
  | 'physics'
  | 'climate'
  | 'general'
export type WorkflowResearchSource = 'arxiv' | 'biorxiv' | 'semantic_scholar' | 'web' | 'cns'

export const WORKFLOW_INPUT_FIELD_TYPES = ['text', 'paragraph', 'number', 'boolean', 'select', 'json'] as const
export type WorkflowInputFieldType = (typeof WORKFLOW_INPUT_FIELD_TYPES)[number]

/** Types offered for a node's typed inputs (subset of the field types — no select/paragraph). */
export const WORKFLOW_NODE_INPUT_TYPES = ['text', 'number', 'boolean', 'json'] as const
export type WorkflowNodeInputType = (typeof WORKFLOW_NODE_INPUT_TYPES)[number]

/**
 * A named, typed input a node pulls from an upstream node's output (dify-style).
 * `source` is an expression ({{$nodes.<id>.json.path}} / {{text}} / {{json.x}});
 * the resolved + coerced value is exposed to the node as {{$input.key}}.
 */
export type WorkflowNodeInputV1 = {
  key: string
  type: WorkflowNodeInputType
  source: string
}

/**
 * The value-type vocabulary the variable picker uses to badge a node's outputs.
 * A trimmed analogue of Dify's VarType — only what our nodes actually emit. NOT
 * persisted (never enters the settings schema); derived on the fly by
 * describeNodeOutput. `object` is drillable (has children); `json` is an opaque
 * blob the user dot-paths into manually; `any` is unknowable. Defer array[*]/file
 * until a node actually produces them.
 */
export const WORKFLOW_VAR_TYPES = ['string', 'number', 'boolean', 'object', 'json', 'any'] as const
export type WorkflowVarType = (typeof WORKFLOW_VAR_TYPES)[number]

/**
 * One advertised output field of a node, for the typed reference picker. `key` is
 * a dot-path relative to the node's json (or the literal 'text'). Derived metadata
 * only — see workflow-output-descriptors.ts. `children` cascades object types.
 */
export type WorkflowOutputVar = {
  key: string
  type: WorkflowVarType
  /** Present only for object types; lets the picker drill in. */
  children?: WorkflowOutputVar[]
  /** Optional human label for the picker row. */
  label?: string
}

/**
 * One typed input the caller supplies when starting a workflow. Drives the
 * "Run once" form, validates the /workflow/run + run_workflow input, and lifts
 * each value onto the run's initial payload.json by `key`.
 */
export type WorkflowInputFieldV1 = {
  key: string
  label: string
  type: WorkflowInputFieldType
  required: boolean
  /** Options for `select`. */
  options: string[]
  defaultValue: string
  description: string
}

/**
 * Triggers carry the run's working directory. When a workflow fires from this
 * trigger, `workspaceRoot` is the default cwd for AI / image / code nodes
 * (empty inherits settings.workflow.defaultWorkspaceRoot, then the app workspace).
 */
export type WorkflowManualTriggerConfigV1 = {
  workspaceRoot?: string
  /** Typed inputs the caller provides when starting the workflow. */
  inputSchema?: WorkflowInputFieldV1[]
}

export type WorkflowScheduleTriggerConfigV1 = {
  schedule: WorkflowScheduleV1
  workspaceRoot?: string
}

export type WorkflowWebhookMethod = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type WorkflowWebhookTriggerConfigV1 = {
  /** Path (leading slash) the local webhook listener matches, e.g. "/my-hook". */
  path: string
  method: WorkflowWebhookMethod
  workspaceRoot?: string
}

export type WorkflowAiAgentConfigV1 = {
  prompt: string
  workspaceRoot: string
  runtimeId?: AgentRuntimeId
  /** UI/model-catalog grouping metadata only; never selects credentials or an endpoint. */
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
}

export type WorkflowLlmConfigV1 = {
  /** Prompt sent directly to the local Model Router. Supports {{json.x}} / {{text}} interpolation. */
  prompt: string
  /** Empty uses the Model Router public model alias. */
  model: string
  /** 0 uses the router/model default. */
  maxTokens: number
}

export type WorkflowGenerateImageConfigV1 = {
  /** Image prompt; supports {{json.x}} / {{text}} interpolation. */
  prompt: string
  /** UI/model-catalog grouping metadata only; image access always uses Model Router. */
  providerId: string
  /** Image model name; empty uses the Model Router image role. */
  model: string
  /** Optional size override (e.g. "1024x1024"); empty uses the provider default. */
  size: string
  /**
   * Folder to save the image into. Empty = <workspace>/workflow-images.
   * Relative paths resolve against the workspace; absolute paths are used as-is.
   * Supports {{json.x}} / {{text}} interpolation.
   */
  outputDir: string
}

export type WorkflowConditionConfigV1 = {
  /** Accessor into the incoming payload, e.g. "text" or "json.value". Empty = previous node's text. */
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

/** One rule of a Switch node; matches feed the output handle `case-<index>`. */
export type WorkflowSwitchRuleV1 = {
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowSwitchConfigV1 = {
  rules: WorkflowSwitchRuleV1[]
  /** When true, expose a `fallback` output for inputs that match no rule. */
  fallback: boolean
}

/** Filter gate: passes the payload through only when the condition holds. */
export type WorkflowFilterConfigV1 = {
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowSortOrder = 'asc' | 'desc'
export type WorkflowSortConfigV1 = {
  /** Field path within each array item; empty sorts by the item itself. */
  field: string
  order: WorkflowSortOrder
  numeric: boolean
}

export type WorkflowLimitFrom = 'first' | 'last'
export type WorkflowLimitConfigV1 = {
  count: number
  from: WorkflowLimitFrom
}

export type WorkflowAggregateMode = 'count' | 'sum' | 'collect' | 'join'
export type WorkflowAggregateConfigV1 = {
  mode: WorkflowAggregateMode
  /** Field path within each array item (for sum/collect/join). */
  field: string
  /** Separator for 'join' mode. */
  separator: string
}

export type WorkflowMergeMode = 'array' | 'object'

export type WorkflowMergeConfigV1 = {
  /** 'array' collects upstream outputs into a list; 'object' shallow-merges object outputs. */
  mode: WorkflowMergeMode
}

export const WORKFLOW_CODE_LANGUAGES = ['javascript', 'python', 'bash'] as const
export type WorkflowCodeLanguage = (typeof WORKFLOW_CODE_LANGUAGES)[number]
export type WorkflowCodeConfigV1 = {
  /** Execution language. javascript runs sandboxed in-process; python/bash spawn a local interpreter. */
  language: WorkflowCodeLanguage
  /**
   * Script body.
   * - javascript: receives $json / $text and may `return` a value (sandboxed, short timeout).
   * - python / bash: input arrives on stdin as JSON and via $WORKFLOW_JSON / $WORKFLOW_TEXT;
   *   whatever the script prints to stdout becomes the output (parsed as JSON when possible).
   */
  code: string
}

export type WorkflowSubWorkflowConfigV1 = {
  /** id of another workflow to run; its output becomes this node's output. */
  workflowId: string
}

/** Renders the payload into a free-form text string (or JSON parsed from it). */
export type WorkflowTemplateConfigV1 = {
  /** Template with {{json.x}} / {{text}} interpolation. */
  template: string
  /** 'text' emits the rendered string; 'json' parses it as JSON (falls back to { text }). */
  outputMode: 'text' | 'json'
}

/** Converts between text and structured JSON. */
export type WorkflowJsonConfigV1 = {
  /** 'parse' turns the incoming text into JSON; 'stringify' serializes the incoming JSON to text. */
  mode: 'parse' | 'stringify'
  /** When parsing, throw on invalid JSON instead of falling back to { text }. */
  strict: boolean
}

/**
 * Terminal node that shapes the workflow's final output — what run_workflow,
 * the local /workflow/run endpoint, and the run viewer treat as the result.
 */
export type WorkflowOutputConfigV1 = {
  /** 'auto' passes the incoming payload through; 'text' renders a template; 'json' extracts a path. */
  mode: 'auto' | 'text' | 'json'
  /** Used in 'text' mode — supports {{json.x}} / {{text}}. */
  textTemplate: string
  /** Used in 'json' mode — dot path into the incoming json (empty = the whole json). */
  jsonPath: string
}

/** A node that runs a user-defined custom module, with the module's field values. */
export type WorkflowCustomConfigV1 = {
  /** id of the WorkflowCustomModuleV1 this node runs. */
  moduleId: string
  /** Field key -> value (stored as strings; coerced by the field's type at runtime). */
  values: Record<string, string>
}

/** dify-style Parameter Extractor: an LLM turns free text into typed JSON fields. */
export type WorkflowParameterExtractorConfigV1 = {
  /** Expression for the source text (default {{text}}). */
  source: string
  instruction: string
  /** Fields to extract (reuses the typed input-field schema). */
  fields: WorkflowInputFieldV1[]
  /** UI/model-catalog grouping metadata only; never selects credentials or an endpoint. */
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

export type WorkflowClassifierCategoryV1 = { id: string; label: string }

/** dify-style Question Classifier: an LLM routes the input to one of N categories. */
export type WorkflowQuestionClassifierConfigV1 = {
  /** Expression for the text to classify (default {{text}}). */
  source: string
  instruction: string
  categories: WorkflowClassifierCategoryV1[]
  /** UI/model-catalog grouping metadata only; never selects credentials or an endpoint. */
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

export type WorkflowApprovalDecision = 'approved' | 'rejected'

/** Human-in-the-loop pause: the run waits for an approve/reject decision before continuing. */
export type WorkflowHumanApprovalConfigV1 = {
  title: string
  instruction: string
  /** Auto-resolve after this many ms; 0 = wait indefinitely. */
  timeoutMs: number
  onTimeout: WorkflowApprovalDecision
}

export const WORKFLOW_MODULE_FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'select'] as const
export type WorkflowModuleFieldType = (typeof WORKFLOW_MODULE_FIELD_TYPES)[number]

/** One input on a custom module's auto-generated form. */
export type WorkflowModuleFieldV1 = {
  /** Identifier exposed to the script as $fields.<key> / WORKFLOW_FIELDS[<key>]. */
  key: string
  label: string
  type: WorkflowModuleFieldType
  /** Default value (string form); number/boolean are coerced from this. */
  defaultValue: string
  /** Options for `select` fields. */
  options: string[]
  placeholder: string
}

/**
 * A reusable, user-defined module = a script (JS/Python/Shell) plus a set of
 * named form fields. Instantiated on the canvas as a `custom` node, which shows
 * a form generated from `fields` and runs `code` with those values injected.
 */
export type WorkflowCustomModuleV1 = {
  id: string
  name: string
  description: string
  /** Reserved for a future icon picker; empty uses a generic module icon. */
  icon: string
  language: WorkflowCodeLanguage
  fields: WorkflowModuleFieldV1[]
  code: string
}

/**
 * Loop agent: repeatedly runs a body workflow, feeding each iteration's output
 * back in as the next input, until the stop condition holds or maxIterations is
 * reached. Turns "you press enter each step" into "you set the goal, the loop runs".
 */
export type WorkflowLoopMode = 'condition' | 'foreach'
export type WorkflowLoopExecution = 'sequential' | 'parallel'

export type WorkflowLoopConfigV1 = {
  /** id of the workflow run once per iteration. */
  workflowId: string
  /** 'condition' (while-loop, default) or 'foreach' (iterate an array). */
  mode?: WorkflowLoopMode
  /** foreach: expression resolving to the array to iterate (empty = the incoming payload json). */
  arraySource?: string
  /** foreach: run items one-at-a-time or concurrently. */
  execution?: WorkflowLoopExecution
  /** foreach: max concurrent iterations when execution = 'parallel' (1-8). */
  concurrency?: number
  /** foreach: collect failed items as { error } instead of aborting the loop. */
  continueOnError?: boolean
  /** Caps iterations (condition mode) and array length (foreach mode). */
  maxIterations: number
  /** Stop-when condition evaluated against each iteration's output (condition mode). */
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowHttpHeaderV1 = {
  key: string
  value: string
}

export type WorkflowHttpRequestConfigV1 = {
  method: WorkflowHttpMethod
  url: string
  headers: WorkflowHttpHeaderV1[]
  /** Templated with {{json.x}} / {{text}} from the incoming payload. */
  body: string
  timeoutMs: number
  /** Parse the response body as JSON into the payload for downstream nodes. */
  parseJson: boolean
}

export type WorkflowResearchSearchConfigV1 = {
  /** Templated with {{json.x}} / {{text}} from the incoming payload. */
  query: string
  intent: WorkflowResearchIntent
  domain: WorkflowResearchDomain
  /** 0 means use the research-search service default. */
  sinceYear: number
  maxResults: number
  sources: WorkflowResearchSource[]
}

export type WorkflowPaperDownloadConfigV1 = {
  /** Relative to the run workspace. Supports {{json.x}} / {{text}} interpolation. */
  outputDir: string
  maxFiles: number
}

export type WorkflowDelayConfigV1 = {
  delayMs: number
}

export type WorkflowFieldV1 = {
  key: string
  /** Templated with {{json.x}} / {{text}} from the incoming payload. */
  value: string
}

export type WorkflowSetFieldsConfigV1 = {
  fields: WorkflowFieldV1[]
  /** When true, merge the new fields onto the incoming json; otherwise replace it. */
  keepIncoming: boolean
  /** 'payload' (default) writes to the node output; 'run' writes into run-scoped vars ({{$run.key}}). */
  scope?: 'payload' | 'run'
}

export type WorkflowNodeConfigByKind = {
  'manual-trigger': WorkflowManualTriggerConfigV1
  'schedule-trigger': WorkflowScheduleTriggerConfigV1
  'webhook-trigger': WorkflowWebhookTriggerConfigV1
  llm: WorkflowLlmConfigV1
  'ai-agent': WorkflowAiAgentConfigV1
  'generate-image': WorkflowGenerateImageConfigV1
  condition: WorkflowConditionConfigV1
  switch: WorkflowSwitchConfigV1
  filter: WorkflowFilterConfigV1
  'set-fields': WorkflowSetFieldsConfigV1
  code: WorkflowCodeConfigV1
  sort: WorkflowSortConfigV1
  limit: WorkflowLimitConfigV1
  aggregate: WorkflowAggregateConfigV1
  'research-search': WorkflowResearchSearchConfigV1
  'paper-download': WorkflowPaperDownloadConfigV1
  'http-request': WorkflowHttpRequestConfigV1
  merge: WorkflowMergeConfigV1
  subworkflow: WorkflowSubWorkflowConfigV1
  loop: WorkflowLoopConfigV1
  delay: WorkflowDelayConfigV1
  template: WorkflowTemplateConfigV1
  json: WorkflowJsonConfigV1
  output: WorkflowOutputConfigV1
  'parameter-extractor': WorkflowParameterExtractorConfigV1
  'question-classifier': WorkflowQuestionClassifierConfigV1
  'human-approval': WorkflowHumanApprovalConfigV1
  custom: WorkflowCustomConfigV1
}

/** How a node behaves when its execution fails after retries. */
export type WorkflowNodeErrorMode = 'fail' | 'continue' | 'fallback'

/** Discriminated union over `type`, each kind carrying its own `config`. */
export type WorkflowNodeV1 = {
  [K in WorkflowNodeKind]: {
    id: string
    type: K
    /** Display label shown on the canvas. */
    name: string
    /** React Flow canvas coordinates. Opaque to the backend. */
    position: { x: number; y: number }
    disabled: boolean
    /** Error policy. Absent = 'fail' (the run stops) — preserves the original behavior. */
    onError?: WorkflowNodeErrorMode
    /** Retry attempts before applying onError (0 = no retry). */
    retries?: number
    retryDelayMs?: number
    /** For onError = 'fallback': JSON the node emits instead of failing. */
    fallbackJson?: string
    /** Named, typed inputs pulled from upstream output; resolved before the node runs as {{$input.key}}. */
    inputs?: WorkflowNodeInputV1[]
    config: WorkflowNodeConfigByKind[K]
  }
}[WorkflowNodeKind]

/** Flat edge array, binds directly to React Flow. Condition uses sourceHandle 'true' | 'false'. */
export type WorkflowConnectionV1 = {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

/** Immutable workflow definition executed by one run. Runtime history is deliberately excluded. */
export type WorkflowExecutionSnapshotV1 = {
  id: string
  name: string
  env: WorkflowEnvVarV1[]
  nodes: WorkflowNodeV1[]
  connections: WorkflowConnectionV1[]
}

export type WorkflowArtifactReferenceV2 = {
  ref: string
  kind: 'artifact' | 'manifest' | 'file' | 'uri'
  digest?: WorkflowFingerprint
  mediaType?: string
}

export type WorkflowActivityReceiptV2 = {
  status: 'success' | 'error'
  outcome: 'progress' | 'retryable_error' | 'fatal_error'
  outputFingerprint?: WorkflowFingerprint
  errorCode?: string
  detail?: string
}

export type WorkflowNodeAttemptV2 = {
  attempt: number
  startedAt: string
  finishedAt: string
  activityFingerprint: WorkflowFingerprint
  inputFingerprint: WorkflowFingerprint
  receiptFingerprint: WorkflowFingerprint
  receipt: WorkflowActivityReceiptV2
  artifactRefs: WorkflowArtifactReferenceV2[]
}

export type WorkflowApprovalRecordV2 = {
  requestId: string
  workflowId: string
  runId: string
  nodeId: string
  nodeName: string
  title: string
  instruction: string
  requestedAt: string
  status: 'pending' | WorkflowApprovalDecision
  decision?: WorkflowApprovalDecision
  resolvedAt?: string
  actor?: string
  rationale?: string
}

export type WorkflowRunContextV2 = {
  workspaceRoot: string
  packageOwner: string
  packageVersion: string
  nodeVersion: string
  platform: string
  architecture: string
  environment: Array<{
    key: string
    type: WorkflowEnvVarV1['type']
    required: boolean
    valueFingerprint?: WorkflowFingerprint
  }>
}

export type WorkflowRunDeterminismV2 = {
  control: 'controlled' | 'uncontrolled'
  reasonCodes: string[]
  stochasticNodeIds: string[]
}

/** Create Loop stores the SDK comparator directly; it does not define a second rerun dialect. */
export type WorkflowRunComparatorV1 =
  SciForgeReproSpecV1['activities'][number]['outputs'][number]['comparator']

export type WorkflowRunDifferenceV1 = {
  component: 'workflow' | 'input' | 'spec' | 'context' | 'output' | 'node' | 'artifact' | 'approval'
  nodeId?: string
  baselineFingerprint?: WorkflowFingerprint
  candidateFingerprint?: WorkflowFingerprint
  reasonCode: string
}

export type WorkflowRunComparisonV1 = {
  classification:
    | 'match'
    | 'input_changed'
    | 'spec_changed'
    | 'context_changed'
    | 'component_changed'
    | 'output_changed'
    | 'unverifiable'
  matches: boolean
  /** Explicit comparability facts consumed by Evidence lineage. */
  sameInput: boolean
  sameSpec: boolean
  sameExecutionContext: boolean
  resultMatch: boolean
  comparisonVerifiable: boolean
  /** A stochastic/uncontrolled mismatch is inconclusive, never a replication failure. */
  replicationStatus: 'matched' | 'failed' | 'inconclusive'
  comparator: WorkflowRunComparatorV1
  reasonCodes: string[]
  differences: WorkflowRunDifferenceV1[]
}

export type WorkflowRunManifestV2 = {
  schema: 'sciforge.create-loop.run.v2'
  source: 'workflow' | 'rerun' | 'migrated'
  workflow: WorkflowExecutionSnapshotV1
  input: DomainPackageJsonValue
  context: WorkflowRunContextV2
  comparator: WorkflowRunComparatorV1
  determinism: WorkflowRunDeterminismV2
  workflowFingerprint: WorkflowFingerprint
  inputFingerprint: WorkflowFingerprint
  specFingerprint: WorkflowFingerprint
  contextFingerprint: WorkflowFingerprint
  outputFingerprint: WorkflowFingerprint
  outputJson: string
  approvalFingerprint: WorkflowFingerprint
  artifactRefs: WorkflowArtifactReferenceV2[]
  approvals: WorkflowApprovalRecordV2[]
  rerunOfRunId?: string
  rerunSpecDigest?: WorkflowFingerprint
  comparison?: WorkflowRunComparisonV1
  legacyIncomplete?: boolean
}

export type WorkflowNodeRunResultV1 = {
  nodeId: string
  status: WorkflowNodeRunStatus
  startedAt: string
  finishedAt: string
  /** Assistant text / HTTP body / condition branch summary. */
  message: string
  /** JSON payload this node emitted, serialized. Empty when none. */
  outputJson: string
  /** JSON payload this node received, serialized. Empty when none. (For the run history viewer.) */
  inputJson?: string
  /** Retry attempts spent before this result (0/absent = first try). */
  retries?: number
  /** For ai-agent nodes: the local runtime thread it created. */
  threadId: string
  error: string
  componentFingerprint: WorkflowFingerprint
  inputFingerprint: WorkflowFingerprint
  outputFingerprint: WorkflowFingerprint
  attempts: WorkflowNodeAttemptV2[]
  artifactRefs: WorkflowArtifactReferenceV2[]
}

/** Result of a single-node test run (not persisted to history). */
export type WorkflowNodeTestResult =
  | { ok: true; result: WorkflowNodeRunResultV1 }
  | { ok: false; message: string }

/** A human-approval node that has paused a run and is awaiting a decision. */
export type WorkflowPendingApprovalV1 = {
  token: string
  workflowId: string
  runId: string
  nodeId: string
  nodeName: string
  title: string
  instruction: string
  createdAt: string
}

export type WorkflowRunV1 = {
  id: string
  /** 'manual' | 'schedule' | trigger node id. */
  trigger: string
  status: WorkflowRunStatus
  startedAt: string
  finishedAt: string
  message: string
  nodeResults: WorkflowNodeRunResultV1[]
  /** Missing only on legacy history; exporting such a run produces a blocked shared spec. */
  manifest?: WorkflowRunManifestV2
}

/** A workflow-scoped variable readable via {{$env.key}} in node expressions. */
export type WorkflowEnvVarV1 = {
  key: string
  value: string
  type: 'string' | 'number' | 'boolean' | 'secret'
}

export type WorkflowV1 = {
  id: string
  name: string
  enabled: boolean
  /** When true, the local runtime may invoke this workflow as a tool (list_workflows / run_workflow). */
  callableByAgent: boolean
  /** Workflow-scoped variables, exposed to node expressions as {{$env.key}}. */
  env: WorkflowEnvVarV1[]
  nodes: WorkflowNodeV1[]
  connections: WorkflowConnectionV1[]
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: WorkflowRunStatus
  lastMessage: string
  /** Bounded history of recent runs (most recent last, capped). */
  runs: WorkflowRunV1[]
}

/**
 * A reusable palette item created by snapshotting a configured node. Dropping it
 * onto the canvas creates a fresh node of `nodeType` pre-filled with `config`.
 */
export type WorkflowNodePresetV1 = {
  id: string
  /** Palette label chosen by the user. */
  label: string
  /** Optional lucide icon name; empty falls back to the node kind's default icon. */
  icon: string
  /** Underlying built-in node kind this preset instantiates. */
  nodeType: WorkflowNodeKind
  /** Default name applied to the created node. */
  nodeName: string
  /** Saved config snapshot; shape matches `nodeType`. */
  config: WorkflowNodeV1['config']
}

/** The local runtime hook phases a workflow can be bound to. Mirrors the bundled runtime HOOK_PHASES. */
export const WORKFLOW_HOOK_PHASES = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'TurnStart',
  'TurnEnd',
  'PreCompact'
] as const
export type WorkflowHookPhase = (typeof WORKFLOW_HOOK_PHASES)[number]

/** How a bound workflow's output maps back to the hook result. */
export const WORKFLOW_HOOK_MODES = ['observe', 'block', 'rewrite'] as const
export type WorkflowHookMode = (typeof WORKFLOW_HOOK_MODES)[number]

/** Binds a Create Loop workflow to a local runtime hook phase (reactive automation). */
export type WorkflowHookTriggerV1 = {
  id: string
  enabled: boolean
  /** Workflow to run when the phase fires. */
  workflowId: string
  phase: WorkflowHookPhase
  /** Exact tool names to match (tool phases only); empty matches all tools. */
  toolNames: string[]
  /**
   * observe = run, change nothing; block = deny the action if the workflow fails/says DENY;
   * rewrite = fold the workflow output into the tool result / injected context.
   */
  mode: WorkflowHookMode
  /** Hook timeout in ms; 0 uses the runtime default. */
  timeoutMs: number
}

export type WorkflowSettingsV1 = {
  enabled: boolean
  defaultWorkspaceRoot: string
  /** Default UI model-group id for new AI nodes; never selects credentials or an endpoint. */
  providerId?: string
  model: string
  mode: ScheduleRunMode
  keepAwake: boolean
  /** Local-only (127.0.0.1) port the webhook-trigger listener binds to. */
  webhookPort: number
  /** Optional shared secret required on inbound webhook requests (x-sciforge-secret / Bearer). */
  webhookSecret: string
  workflows: WorkflowV1[]
  /** Reusable palette items the user saved from configured nodes. */
  presets: WorkflowNodePresetV1[]
  /** User-defined script-backed modules. */
  modules: WorkflowCustomModuleV1[]
  /** Workflows bound to local runtime hook phases (reactive automation in code mode). */
  hookTriggers: WorkflowHookTriggerV1[]
}

export type WorkflowSettingsPatchV1 = Partial<Omit<WorkflowSettingsV1, 'workflows'>> & {
  /** Replaced wholesale when present. */
  workflows?: Array<Partial<WorkflowV1>>
}

export type WorkflowRunResult =
  | { ok: true; runId: string; status: WorkflowRunStatus; message: string }
  | { ok: false; message: string }

/** Result of an editor-time syntax check on a Code node's script. */
export type WorkflowCodeCheckResult =
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

export type WorkflowNodeStatusMap = Record<string, WorkflowNodeRunStatus>

export type WorkflowRuntimeStatus = {
  runningWorkflowIds: string[]
  /** workflowId -> nodeId -> live status, for lighting up the canvas during a run. */
  nodeStatus: Record<string, WorkflowNodeStatusMap>
  /** workflowId -> nodeId -> live per-node result (input/output/timing), for the run-log panel. */
  nodeResults: Record<string, Record<string, WorkflowNodeRunResultV1>>
  powerSaveBlockerActive: boolean
  /** Human-approval nodes currently paused, awaiting an approve/reject decision. */
  pendingApprovals: WorkflowPendingApprovalV1[]
}


export const CREATE_LOOP_RESOURCE_KIND = 'create-loop-settings'
export const CREATE_LOOP_CAPABILITY_IDS = Object.freeze({
  read: 'create-loop.read',
  save: 'create-loop.save',
  run: 'create-loop.run',
  stop: 'create-loop.stop',
  status: 'create-loop.status',
  resolveApproval: 'create-loop.resolve-approval',
  runNode: 'create-loop.run-node',
  testNode: 'create-loop.test-node',
  checkCode: 'create-loop.check-code',
  importDsl: 'create-loop.import-dsl',
  exportDsl: 'create-loop.export-dsl',
  exportRerun: 'create-loop.export-rerun'
} as const)

export type CreateLoopSnapshot = Readonly<{
  revision: number
  settings: WorkflowSettingsV1
}>

const createLoopSettingsWireSchema = domainPackageJsonValueSchema.refine(
  isWorkflowSettings,
  'Expected canonical Create Loop settings.'
)
const createLoopWorkflowWireSchema = domainPackageJsonValueSchema.refine(
  (value): value is WorkflowV1 => (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.connections)
  ),
  'Expected a canonical Create Loop workflow.'
)
const workflowFingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u)
const workflowArtifactReferenceSchema = z.object({
  ref: z.string().trim().min(1).max(4_096),
  kind: z.enum(['artifact', 'manifest', 'file', 'uri']),
  digest: workflowFingerprintSchema.optional(),
  mediaType: z.string().trim().min(1).max(512).optional()
}).strict()
const workflowActivityReceiptSchema = z.object({
  status: z.enum(['success', 'error']),
  outcome: z.enum(['progress', 'retryable_error', 'fatal_error']),
  outputFingerprint: workflowFingerprintSchema.optional(),
  errorCode: z.string().trim().min(1).max(256).optional(),
  detail: z.string().max(10_000).optional()
}).strict()
const workflowNodeAttemptSchema = z.object({
  attempt: z.number().int().nonnegative().max(100),
  startedAt: z.string().max(128),
  finishedAt: z.string().max(128),
  activityFingerprint: workflowFingerprintSchema,
  inputFingerprint: workflowFingerprintSchema,
  receiptFingerprint: workflowFingerprintSchema,
  receipt: workflowActivityReceiptSchema,
  artifactRefs: z.array(workflowArtifactReferenceSchema).max(1_000)
}).strict()
const createLoopNodeRunResultSchema = z.object({
  nodeId: z.string().max(256),
  status: z.enum(['pending', 'running', 'success', 'error', 'skipped']),
  startedAt: z.string().max(128),
  finishedAt: z.string().max(128),
  message: z.string().max(1_000_000),
  outputJson: z.string().max(5_000_000),
  inputJson: z.string().max(5_000_000).optional(),
  retries: z.number().int().nonnegative().optional(),
  threadId: z.string().max(512),
  error: z.string().max(1_000_000),
  componentFingerprint: workflowFingerprintSchema,
  inputFingerprint: workflowFingerprintSchema,
  outputFingerprint: workflowFingerprintSchema,
  attempts: z.array(workflowNodeAttemptSchema).max(100),
  artifactRefs: z.array(workflowArtifactReferenceSchema).max(1_000)
}).strict()
const createLoopPendingApprovalSchema = z.object({
  token: z.string().max(512),
  workflowId: z.string().max(256),
  runId: z.string().max(256),
  nodeId: z.string().max(256),
  nodeName: z.string().max(500),
  title: z.string().max(500),
  instruction: z.string().max(100_000),
  createdAt: z.string().max(128)
}).strict()

export const createLoopReadInputSchema = z.object({}).strict()
export const createLoopSaveInputSchema = z.object({
  settings: createLoopSettingsWireSchema,
  expectedRevision: z.number().int().min(0).optional()
}).strict()
export const createLoopWorkflowInputSchema = z.object({
  workflowId: z.string().trim().min(1).max(256).optional(),
  input: domainPackageJsonValueSchema.optional(),
  rerunSpec: sciforgeReproSpecSchema.optional(),
  activityId: z.string().trim().min(1).max(512).optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.workflowId) === Boolean(value.rerunSpec)) {
    context.addIssue({
      code: 'custom',
      message: 'Provide exactly one of workflowId or rerunSpec.'
    })
  }
  if (value.rerunSpec && value.input !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['input'],
      message: 'A rerun uses the immutable input embedded in rerunSpec.'
    })
  }
  if (value.activityId && !value.rerunSpec) {
    context.addIssue({
      code: 'custom',
      path: ['activityId'],
      message: 'activityId is only valid when rerunSpec is provided.'
    })
  }
})
export const createLoopStopInputSchema = z.object({
  workflowId: z.string().trim().min(1).max(256)
}).strict()
export const createLoopApprovalInputSchema = z.object({
  token: z.string().trim().min(1).max(512),
  decision: z.enum(['approved', 'rejected']),
  actor: z.string().trim().min(1).max(512).optional(),
  rationale: z.string().max(10_000).optional()
}).strict()
export const createLoopRunNodeInputSchema = z.object({
  workflowId: z.string().trim().min(1).max(256),
  nodeId: z.string().trim().min(1).max(256)
}).strict()
export const createLoopTestNodeInputSchema = createLoopRunNodeInputSchema.extend({
  mockJson: z.string().max(1_000_000)
}).strict()
export const createLoopCheckCodeInputSchema = z.object({
  language: z.enum(WORKFLOW_CODE_LANGUAGES),
  code: z.string().max(1_000_000)
}).strict()
export const createLoopDslInputSchema = z.object({ dsl: z.string().max(5_000_000) }).strict()
export const createLoopExportInputSchema = z.object({ workflowId: z.string().trim().min(1).max(256) }).strict()
export const createLoopExportRerunInputSchema = z.object({
  workflowId: z.string().trim().min(1).max(256),
  runId: z.string().trim().min(1).max(256),
  comparator: reproOutputComparatorSchema.optional()
}).strict()

export const createLoopSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  settings: createLoopSettingsWireSchema
}).strict()
export const createLoopRunResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    runId: z.string().max(256),
    status: z.enum(['idle', 'running', 'success', 'error']),
    message: z.string().max(1_000_000)
  }).strict(),
  z.object({
    ok: z.literal(false),
    message: z.string().max(1_000_000)
  }).strict()
])
export const createLoopRuntimeStatusSchema = z.object({
  runningWorkflowIds: z.array(z.string().max(256)).max(10_000),
  nodeStatus: z.record(
    z.string().max(256),
    z.record(
      z.string().max(256),
      z.enum(['pending', 'running', 'success', 'error', 'skipped'])
    )
  ),
  nodeResults: z.record(
    z.string().max(256),
    z.record(z.string().max(256), createLoopNodeRunResultSchema)
  ),
  powerSaveBlockerActive: z.boolean(),
  pendingApprovals: z.array(createLoopPendingApprovalSchema).max(10_000)
}).strict()
export const createLoopNodeTestResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: createLoopNodeRunResultSchema }).strict(),
  z.object({ ok: z.literal(false), message: z.string().max(1_000_000) }).strict()
])
export const createLoopCodeCheckResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }).strict(),
  z.object({
    status: z.literal('error'),
    message: z.string().max(1_000_000)
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    message: z.string().max(1_000_000)
  }).strict()
])
export const createLoopWorkflowSchema = createLoopWorkflowWireSchema
export const createLoopDslOutputSchema = z.object({ dsl: z.string() }).strict()
export const createLoopApprovalOutputSchema = z.object({ resolved: z.boolean() }).strict()

export function isWorkflowSettings(value: unknown): value is WorkflowSettingsV1 {
  return isRecord(value) && typeof value.enabled === 'boolean' &&
    typeof value.defaultWorkspaceRoot === 'string' && Array.isArray(value.workflows) &&
    Array.isArray(value.presets) && Array.isArray(value.modules) && Array.isArray(value.hookTriggers)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
