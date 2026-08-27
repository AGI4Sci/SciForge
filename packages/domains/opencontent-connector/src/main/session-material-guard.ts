import { OpenContentConnectorError } from '../contract.js'

const SESSION_RESULT_MAX_DEPTH = 32
const SESSION_RESULT_MAX_OBJECTS = 10_000
const SESSION_RESULT_MAX_PROPERTIES = 100_000
const SESSION_RESULT_MAX_STRING_CHARACTERS = 4_000_000

/**
 * Provider data must not turn the protected Token into a returned value or a
 * retained operation input. Inspect only own data properties, never accessors
 * or function closures, while the Host redaction lease is still active.
 */
export function assertNoOpenContentSessionTokenEcho(
  value: unknown,
  secret: string
): void {
  const visited = new WeakSet<object>()
  let objectCount = 0
  let propertyCount = 0
  let stringCharacterCount = 0

  const inspectString = (candidate: string): void => {
    stringCharacterCount += candidate.length
    if (
      stringCharacterCount > SESSION_RESULT_MAX_STRING_CHARACTERS ||
      candidate.includes(secret)
    ) throw sessionMaterialViolation()
  }

  const visit = (candidate: unknown, depth: number): void => {
    if (typeof candidate === 'string') {
      inspectString(candidate)
      return
    }
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof candidate === 'function'
    ) return
    if (depth > SESSION_RESULT_MAX_DEPTH) throw sessionMaterialViolation()
    if (visited.has(candidate)) return
    visited.add(candidate)
    objectCount += 1
    if (objectCount > SESSION_RESULT_MAX_OBJECTS) throw sessionMaterialViolation()

    let descriptors: PropertyDescriptorMap
    try {
      descriptors = Object.getOwnPropertyDescriptors(candidate)
    } catch {
      throw sessionMaterialViolation()
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      propertyCount += 1
      if (propertyCount > SESSION_RESULT_MAX_PROPERTIES) {
        throw sessionMaterialViolation()
      }
      inspectString(key)
      if ('value' in descriptor && typeof descriptor.value !== 'function') {
        visit(descriptor.value, depth + 1)
      }
    }
  }

  visit(value, 0)
}

function sessionMaterialViolation(): OpenContentConnectorError {
  return new OpenContentConnectorError(
    'provider_contract_violation',
    'The OpenContent Provider returned protected session material or an unbounded result.'
  )
}
