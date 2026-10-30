export function parseCapabilityEvalArgs(argv, { booleanFlags = [] } = {}) {
  const result = {}
  const booleans = new Set(booleanFlags)
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { result.help = true; continue }
    if (arg.startsWith('--') && booleans.has(arg)) {
      result[toCamelCase(arg.slice(2))] = true
      continue
    }
    if (arg.startsWith('--') && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      result[toCamelCase(arg.slice(2))] = argv[index + 1]
      index += 1
      continue
    }
    throw new Error(`Unknown argument ${arg}`)
  }
  return result
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, character) => character.toUpperCase())
}
