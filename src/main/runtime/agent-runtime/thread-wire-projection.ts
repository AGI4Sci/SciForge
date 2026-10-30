import type { AgentRuntimeCompletionReceipt, AgentRuntimeItem, AgentRuntimeThreadSnapshot } from '../../../shared/agent-runtime-contract'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type ThreadScope = Readonly<{ runtimeId: string; threadId: string; workspaceRoot: string }>

// Deliberately explicit: only contract-declared optional members may be omitted.
// Unknown fields and opaque metadata must remain lossless JSON or fail closed.
const optionalItemFields = {
  turnId: true, text: true, summary: true, status: true, toolKind: true,
  effects: true, completionReceipts: true, detail: true, detailArtifact: true,
  outputStatus: true, meta: true, createdAt: true, principal: true, principalContext: true
} satisfies Record<Exclude<keyof AgentRuntimeItem, 'id' | 'kind'>, true>

const optionalReceiptFields = {
  relatedRefs: true, parentReceiptIds: true, attestation: true, sha256: true
} satisfies Record<Exclude<keyof AgentRuntimeCompletionReceipt,
  'contractVersion' | 'receiptId' | 'kind' | 'status' | 'issuer' | 'callId' | 'subjectRef' | 'createdAt'>, true>

function encodeJson(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  optionalFields: Readonly<Record<string, true>> = {},
  receiptArray = false
): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const invalid = () => new TypeError(`Thread wire projection requires lossless acyclic plain JSON at ${path}.`)
  if (typeof value !== 'object' || ancestors.has(value)) throw invalid()
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (array) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, index)) throw invalid()
    }
  }
  const result: Json[] | { [key: string]: Json } = array ? [] : {}
  ancestors.add(value)
  try {
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue
      if (typeof key !== 'string') throw invalid()
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid()
      // Arrays have only indices on the wire; never silently discard own extras.
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw invalid()
      if (descriptor.value === undefined && Object.hasOwn(optionalFields, key)) continue
      Object.defineProperty(result, key, {
        value: encodeJson(descriptor.value, `${path}.${key}`, ancestors,
          receiptArray ? optionalReceiptFields : undefined,
          optionalFields === optionalItemFields && key === 'completionReceipts'),
        enumerable: true, writable: true, configurable: true
      })
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

/** Application-owned explicit wire DTO, not a cast of runtime-owned objects. */
export function projectAgentRuntimeThreadSnapshot(snapshot: AgentRuntimeThreadSnapshot, scope: ThreadScope) {
  if (snapshot.runtimeId !== scope.runtimeId || snapshot.id !== scope.threadId ||
      snapshot.workspace !== scope.workspaceRoot || !snapshot.workspace) {
    throw new Error('Canonical thread projection scope mismatch.')
  }
  return {
    runtimeId: snapshot.runtimeId,
    threadId: snapshot.id,
    workspaceRoot: snapshot.workspace,
    watermark: String(snapshot.latestSeq),
    trace: snapshot.turns.flatMap(turn => (turn.items ?? []).map((item, index) =>
      encodeJson(item, `$.trace.${turn.id}.${index}`, new Set(), optionalItemFields) as Readonly<Record<string, Json>>
    ))
  }
}
