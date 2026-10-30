export function parseSteerCommand(input: string): string | false {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/steer')) return false
  const rest = trimmed.slice(6)
  if (rest.length > 0 && !/^\s/.test(rest)) return false
  return rest.trim()
}
