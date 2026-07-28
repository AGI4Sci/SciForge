export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue }

export function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const objectValue = value as { readonly [key: string]: CanonicalJsonValue }
  return `{${Object.keys(objectValue).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(objectValue[key]!)}`
  ).join(',')}}`
}
