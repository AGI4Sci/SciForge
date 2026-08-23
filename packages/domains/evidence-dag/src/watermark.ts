type ParsedWatermark = Readonly<{
  family: string
  sequence: bigint
  subsecondNumerator: bigint
  subsecondDenominator: bigint
  discriminator: string
  batchNumerator: bigint
  batchDenominator: bigint
}>

const BATCH_SUFFIX = /:batch:(\d+)\/(\d+)$/u
const LEADING_SEQUENCE = /^(\d+)(?::(.*))?$/u
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/u

/**
 * Compares watermark forms owned by Evidence. `undefined` means that coverage
 * cannot be proven, so callers must retain the pending obligation.
 */
export function compareEvidenceDagWatermarks(
  left: string,
  right: string
): number | undefined {
  const normalizedLeft = left.trim()
  const normalizedRight = right.trim()
  if (!normalizedLeft || !normalizedRight) return undefined
  if (normalizedLeft === normalizedRight) return 0
  const parsedLeft = parseWatermark(normalizedLeft)
  const parsedRight = parseWatermark(normalizedRight)
  if (!parsedLeft || !parsedRight || parsedLeft.family !== parsedRight.family) {
    return undefined
  }
  const sequence = compareBigInt(parsedLeft.sequence, parsedRight.sequence)
  if (sequence !== 0) return sequence
  const subsecond = compareFractions(
    parsedLeft.subsecondNumerator,
    parsedLeft.subsecondDenominator,
    parsedRight.subsecondNumerator,
    parsedRight.subsecondDenominator
  )
  if (subsecond !== 0) return subsecond
  if (parsedLeft.discriminator !== parsedRight.discriminator) return undefined
  return compareFractions(
    parsedLeft.batchNumerator,
    parsedLeft.batchDenominator,
    parsedRight.batchNumerator,
    parsedRight.batchDenominator
  )
}

export function laterEvidenceDagWatermark(
  current: string,
  candidate: string
): string | undefined {
  const comparison = compareEvidenceDagWatermarks(current, candidate)
  if (comparison === undefined) return undefined
  return comparison < 0 ? candidate : current
}

export function evidenceDagWatermarkCoversValue(
  committed: string,
  target: string
): boolean {
  const comparison = compareEvidenceDagWatermarks(committed, target)
  return comparison !== undefined && comparison >= 0
}

function parseWatermark(value: string): ParsedWatermark | null {
  const batch = BATCH_SUFFIX.exec(value)
  const base = batch ? value.slice(0, batch.index) : value
  const batchNumerator = batch ? BigInt(batch[1]!) : 1n
  const batchDenominator = batch ? BigInt(batch[2]!) : 1n
  if (
    batchNumerator < 1n ||
    batchDenominator < 1n ||
    batchNumerator > batchDenominator
  ) {
    return null
  }

  // Artifact lifecycle receipts are independent durable obligations. Only
  // adaptive batches of the exact same receipt can cover one another.
  if (base.includes(':artifact-lifecycle')) {
    return parsed(
      `artifact-lifecycle:${base}`,
      0n,
      '',
      batchNumerator,
      batchDenominator
    )
  }

  const leading = LEADING_SEQUENCE.exec(base)
  if (leading) {
    return parsed(
      'leading-sequence',
      BigInt(leading[1]!),
      leading[2] ?? '',
      batchNumerator,
      batchDenominator
    )
  }

  const timestamp = parseStrictTimestamp(base)
  if (timestamp) {
    return {
      family: 'timestamp',
      sequence: timestamp.epochSeconds,
      subsecondNumerator: timestamp.subsecondNumerator,
      subsecondDenominator: timestamp.subsecondDenominator,
      discriminator: '',
      batchNumerator,
      batchDenominator
    }
  }
  return parsed(
    `opaque:${base}`,
    0n,
    '',
    batchNumerator,
    batchDenominator
  )
}

function parsed(
  family: string,
  sequence: bigint,
  discriminator: string,
  batchNumerator: bigint,
  batchDenominator: bigint
): ParsedWatermark {
  return {
    family,
    sequence,
    subsecondNumerator: 0n,
    subsecondDenominator: 1n,
    discriminator,
    batchNumerator,
    batchDenominator
  }
}

function parseStrictTimestamp(value: string): Readonly<{
  epochSeconds: bigint
  subsecondNumerator: bigint
  subsecondDenominator: bigint
}> | null {
  const match = TIMESTAMP.exec(value)
  if (!match || (match[7]?.length ?? 0) > 512) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = Number(match[10] ?? 0)
  const offsetMinute = Number(match[11] ?? 0)
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > calendarDaysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null
  }
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, 0)
  const offsetSign = match[9] === '-' ? -1 : 1
  const offsetMilliseconds = match[8] === 'Z'
    ? 0
    : offsetSign * ((offsetHour * 60) + offsetMinute) * 60_000
  const epochMilliseconds = local.getTime() - offsetMilliseconds
  if (!Number.isSafeInteger(epochMilliseconds)) return null
  const utcYear = new Date(epochMilliseconds).getUTCFullYear()
  if (utcYear < 1 || utcYear > 9_999) return null
  const fraction = match[7] ?? ''
  return {
    epochSeconds: BigInt(epochMilliseconds / 1_000),
    subsecondNumerator: fraction ? BigInt(fraction) : 0n,
    subsecondDenominator: fraction ? 10n ** BigInt(fraction.length) : 1n
  }
}

function calendarDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return leap ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
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
