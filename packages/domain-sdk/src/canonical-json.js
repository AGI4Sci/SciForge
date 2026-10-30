/** Canonical JSON bytes shared by browser, Node and emitted package consumers. */
export function canonicalizeJson(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    assertValidUnicode(value)
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError('Value is not canonical JSON.')
    return serialized
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON requires finite numbers.')
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError('Value is not canonical JSON.')
    return serialized
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError('Canonical JSON cannot contain sparse arrays.')
    }
    return `[${value.map(canonicalizeJson).join(',')}]`
  }
  if (!value || typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError('Value is not canonical JSON.')
  }
  const keys = Object.keys(value)
  keys.forEach(assertValidUnicode)
  return `{${keys
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
    .join(',')}}`
}

/** RFC 8785 forbids lone UTF-16 surrogates because they are not Unicode scalar values. */
function assertValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError('Canonical JSON cannot contain a lone UTF-16 surrogate.')
      }
      index += 1
      continue
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Canonical JSON cannot contain a lone UTF-16 surrogate.')
    }
  }
}
