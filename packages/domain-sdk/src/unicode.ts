/** Replaces unpaired UTF-16 surrogates with the Unicode replacement character. */
export function toWellFormedUnicode(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1]
        index += 1
      } else {
        output += '\ufffd'
      }
      continue
    }
    output += code >= 0xdc00 && code <= 0xdfff ? '\ufffd' : value[index]
  }
  return output
}

/** Truncates to a UTF-16 code-unit budget without splitting a Unicode scalar. */
export function truncateWellFormedUnicode(value: string, maxCodeUnits: number): string {
  const wellFormed = toWellFormedUnicode(value)
  const limit = Math.max(0, Math.floor(maxCodeUnits))
  if (wellFormed.length <= limit) return wellFormed
  let end = limit
  if (
    end > 0 &&
    wellFormed.charCodeAt(end - 1) >= 0xd800 &&
    wellFormed.charCodeAt(end - 1) <= 0xdbff
  ) {
    end -= 1
  }
  return wellFormed.slice(0, end)
}

/** Truncates to a UTF-8 byte budget at Unicode scalar boundaries. */
export function truncateWellFormedUtf8(value: string, maxBytes: number): string {
  const wellFormed = toWellFormedUnicode(value)
  const limit = Math.max(0, Math.floor(maxBytes))
  let bytes = 0
  const output: string[] = []
  for (const character of wellFormed) {
    const codePoint = character.codePointAt(0) ?? 0
    const size = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    if (bytes + size > limit) return output.join('')
    output.push(character)
    bytes += size
  }
  return wellFormed
}
