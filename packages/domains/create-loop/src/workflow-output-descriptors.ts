import type {
  WorkflowInputFieldType,
  WorkflowNodeInputType,
  WorkflowNodeV1,
  WorkflowOutputVar,
  WorkflowVarType
} from './contract.js'

/**
 * Declarative mirror of the per-node output shapes that `executeNode` produces in
 * the package-owned runtime. This is advisory metadata only — it never enters
 * the run path; it powers the renderer's typed variable picker and dangling-ref
 * validation. Kinds whose output is opaque or a pass-through return [] so the
 * picker falls back to the whole-node .json / .text escape hatches.
 *
 * Keep this in sync with workflow-runtime.ts executeNode: each arm here matches a
 * `return { payload: { json: … } }` there (ai-agent→{text}, generate-image→
 * {imagePath,mimeType}, http→{status,body} unless parseJson, etc.).
 */
export function describeNodeOutput(node: WorkflowNodeV1): WorkflowOutputVar[] {
  switch (node.type) {
    case 'llm':
    case 'ai-agent':
      return [{ key: 'text', type: 'string' }]
    case 'generate-image':
      return [
        { key: 'imagePath', type: 'string' },
        { key: 'mimeType', type: 'string' }
      ]
    case 'http-request':
      // parseJson replaces the {status, body} envelope with the parsed body (opaque).
      return node.config.parseJson
        ? []
        : [
            { key: 'status', type: 'number' },
            { key: 'body', type: 'string' }
          ]
    case 'parameter-extractor':
      return fieldsToVars(node.config.fields)
    case 'set-fields':
      // scope 'run' passes the payload through and writes to {{$run.*}} instead.
      return (node.config.scope ?? 'payload') === 'run'
        ? []
        : node.config.fields
            .filter((field) => field.key.trim())
            .map((field) => ({ key: field.key, type: 'string' as WorkflowVarType }))
    case 'aggregate':
      switch (node.config.mode) {
        case 'sum':
          return [{ key: 'sum', type: 'number' }]
        case 'count':
          return [{ key: 'count', type: 'number' }]
        case 'join':
          return [{ key: 'text', type: 'string' }]
        case 'collect':
          return [{ key: 'values', type: 'json' }]
        default:
          return []
      }
    case 'research-search':
      return [
        { key: 'papers', type: 'json' },
        { key: 'webResults', type: 'json' },
        { key: 'citations', type: 'json' },
        { key: 'themes', type: 'json' },
        { key: 'gaps', type: 'json' },
        { key: 'suggestedFollowups', type: 'json' }
      ]
    case 'paper-download':
      return [
        { key: 'papers', type: 'json' },
        { key: 'downloads', type: 'json' },
        { key: 'downloadFolder', type: 'string' }
      ]
    case 'template':
      return node.config.outputMode === 'text' ? [{ key: 'text', type: 'string' }] : []
    case 'json':
      return node.config.mode === 'stringify' ? [{ key: 'text', type: 'string' }] : []
    case 'manual-trigger':
      return fieldsToVars(node.config.inputSchema ?? [])
    default:
      // condition/switch/filter/sort/limit/merge/code/loop/subworkflow/delay/output/
      // classifier/human-approval/custom: opaque or pass-through → no typed fields.
      return []
  }
}

function fieldsToVars(fields: { key: string; type: WorkflowInputFieldType; label?: string }[]): WorkflowOutputVar[] {
  return fields
    .filter((field) => field.key.trim())
    .map((field) => ({
      key: field.key,
      type: mapInputFieldType(field.type),
      ...(field.label ? { label: field.label } : {})
    }))
}

function mapInputFieldType(type: WorkflowInputFieldType): WorkflowVarType {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'json':
      return 'json'
    default:
      // text, paragraph, select
      return 'string'
  }
}

/** Coerce a picked output var's type to the narrower vocabulary a node input binding stores. */
export function varTypeToInputType(type: WorkflowVarType): WorkflowNodeInputType {
  switch (type) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
    case 'json':
      return 'json'
    default:
      // string, any
      return 'text'
  }
}

/**
 * The {{$nodes.<id>(.path)}} references inside an arbitrary template string.
 * Distinct from the runtime's general {{ }} interpolation: this only surfaces
 * cross-node references so the editor can flag ones whose node/field is gone.
 */
const NODE_REF_RE = /\{\{\s*\$nodes\.([A-Za-z0-9_-]+)((?:\.[^}\s]+)*)\s*\}\}/g

export type WorkflowNodeRef = {
  /** The full matched token, e.g. "{{$nodes.abc.json.title}}". */
  token: string
  /** The referenced upstream node id. */
  nodeId: string
  /** The first path segment after the id, normalized (json/text stripped), or '' for whole-node. */
  firstField: string
}

export function extractNodeRefs(template: string): WorkflowNodeRef[] {
  const refs: WorkflowNodeRef[] = []
  for (const match of template.matchAll(NODE_REF_RE)) {
    const nodeId = match[1]
    // match[2] = ".json.title" | ".text" | ".title" | "" — peel the leading dot + json prefix.
    const path = match[2].replace(/^\./, '').replace(/^json\.?/, '').replace(/^text$/, '')
    const firstField = path.split('.')[0] ?? ''
    refs.push({ token: match[0], nodeId, firstField })
  }
  return refs
}
