type ParsedWatermark = Readonly<{
  family: string
  sequence: bigint
  discriminator: string
  batchNumerator: bigint
  batchDenominator: bigint
}>

const BATCH_SUFFIX = /:batch:(\d+)\/(\d+)$/u
const LEADING_SEQUENCE = /^(\d+)(?::(.*))?$/u
const TRAILING_SEQUENCE = /^(.*?)(\d+)$/u

/** Compare the monotonic watermark forms emitted by SciForge runtimes. */
export function compareEvidenceDagWatermarks(left: string, right: string): number | undefined {
  if (left === right) return 0
  const parsedLeft = parseWatermark(left)
  const parsedRight = parseWatermark(right)
  if (!parsedLeft || !parsedRight || parsedLeft.family !== parsedRight.family) return undefined
  const sequence = compareBigInt(parsedLeft.sequence, parsedRight.sequence)
  if (sequence !== 0) return sequence
  const discriminator = parsedLeft.discriminator.localeCompare(parsedRight.discriminator)
  if (discriminator !== 0) return discriminator < 0 ? -1 : 1
  return compareFractions(
    parsedLeft.batchNumerator,
    parsedLeft.batchDenominator,
    parsedRight.batchNumerator,
    parsedRight.batchDenominator
  )
}

export function laterEvidenceDagWatermark(current: string, candidate: string): string {
  const comparison = compareEvidenceDagWatermarks(current, candidate)
  return comparison === undefined || comparison < 0 ? candidate : current
}

export function evidenceDagWatermarkCoversValue(committed: string, target: string): boolean {
  const comparison = compareEvidenceDagWatermarks(committed, target)
  return comparison !== undefined && comparison >= 0
}

function parseWatermark(raw: string): ParsedWatermark | null {
  const text = raw.trim()
  if (!text) return null
  const batch = BATCH_SUFFIX.exec(text)
  const base = batch ? text.slice(0, batch.index) : text
  const numerator = batch ? BigInt(batch[1]!) : 1n
  const denominator = batch ? BigInt(batch[2]!) : 1n
  if (numerator < 1n || denominator < 1n || numerator > denominator) return null

  const leading = LEADING_SEQUENCE.exec(base)
  if (leading) {
    return {
      family: 'leading-sequence',
      sequence: BigInt(leading[1]!),
      discriminator: leading[2] ?? '',
      batchNumerator: numerator,
      batchDenominator: denominator
    }
  }
  const timestamp = Date.parse(base)
  if (Number.isFinite(timestamp)) {
    return {
      family: 'timestamp',
      sequence: BigInt(timestamp),
      discriminator: '',
      batchNumerator: numerator,
      batchDenominator: denominator
    }
  }
  const trailing = TRAILING_SEQUENCE.exec(base)
  if (trailing?.[1]) {
    return {
      family: `trailing-sequence:${trailing[1]}`,
      sequence: BigInt(trailing[2]!),
      discriminator: '',
      batchNumerator: numerator,
      batchDenominator: denominator
    }
  }
  return null
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareFractions(
  leftNumerator: bigint,
  leftDenominator: bigint,
  rightNumerator: bigint,
  rightDenominator: bigint
): number {
  return compareBigInt(
    leftNumerator * rightDenominator,
    rightNumerator * leftDenominator
  )
}
