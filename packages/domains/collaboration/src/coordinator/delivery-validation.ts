import { createHash } from 'node:crypto'
import type { DeliveryValidationSpec } from './delivery-validation-contract.js'

export const VALIDATION_MAX_BYTES = 1_048_576
export function validationDigest(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
    if (item !== null && typeof item === 'object') return `{${Object.keys(item).sort().map(key =>
      `${JSON.stringify(key)}:${canonical((item as Record<string, unknown>)[key])}`).join(',')}}`
    return JSON.stringify(item)
  }
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** Only evaluates the frozen assertions over these exact bytes; never a general scientific certificate. */
export function checkDeliveryJson(spec: DeliveryValidationSpec, body: Uint8Array): { status: 'passed' | 'failed' | 'unknown'; detail: string } {
  if (body.byteLength > VALIDATION_MAX_BYTES) return { status: 'unknown', detail: 'Object exceeds the JSON validation limit.' }
  if (body.byteLength !== spec.target.object.byteCount || createHash('sha256').update(body).digest('hex') !== spec.target.object.sha256) {
    return { status: 'unknown', detail: 'Exact sealed byte identity mismatch.' }
  }
  let document: unknown
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) }
  catch { return { status: 'unknown', detail: 'Object is not valid UTF-8 JSON.' } }
  for (const [index, assertion] of spec.assertions.entries()) {
    let value = document
    for (const key of assertion.path) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
        return { status: 'failed', detail: `Assertion ${index + 1}: missing path.` }
      }
      value = (value as Record<string, unknown>)[key]
    }
    const passed = assertion.kind === 'equals' ? value === assertion.expected
      : typeof value === 'number' && Number.isFinite(value) && value >= assertion.min && value <= assertion.max
    if (!passed) return { status: 'failed', detail: `Assertion ${index + 1}: condition failed.` }
  }
  return { status: 'passed', detail: 'All frozen JSON assertions passed; scope is limited to the specified fields and bounds.' }
}
