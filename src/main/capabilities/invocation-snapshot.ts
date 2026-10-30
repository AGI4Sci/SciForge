// Match the ProcessExtensionHost lossless JSON boundary, without importing a
// plugin implementation or including the live AbortSignal in serialized facts.
export function isLosslessJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const prototype = Object.getPrototypeOf(value)
  const array = Array.isArray(value)
  const keys = Reflect.ownKeys(value)
  const valid = (array
    ? prototype === Array.prototype && keys.length === value.length + 1
    : prototype === Object.prototype || prototype === null)
    && keys.every((key) => {
      if (array && key === 'length') return true
      if (typeof key !== 'string') return false
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      // JSON ignores hidden/symbol/extra array fields; accessors can change
      // between validation and cloning. Only enumerable data is lossless.
      return descriptor.enumerable === true && 'value' in descriptor
        && isLosslessJsonValue(descriptor.value, seen)
    })
  seen.delete(value)
  return valid
}

export function freezeInvocationSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    for (const child of Object.values(value)) freezeInvocationSnapshot(child, seen)
    Object.freeze(value)
  }
  return value
}
