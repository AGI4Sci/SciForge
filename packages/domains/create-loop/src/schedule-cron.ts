/**
 * Minimal five-field cron support for schedule triggers.
 *
 * Fields, in order: minute (0-59), hour (0-23), day of month (1-31),
 * month (1-12), day of week (0-7, 0 and 7 both mean Sunday).
 * Each field accepts `*`, a value, a range `a-b`, a step `* / n` or `a-b / n`,
 * and comma-separated lists of those. Names (`MON`, `JAN`) and the `@daily`
 * shorthands are rejected rather than guessed.
 *
 * Times are resolved in the host's local time zone, matching the existing
 * `daily` and `at` schedule kinds. A day matches when the day-of-month field
 * matches, the day-of-week field matches, or both fields are unrestricted;
 * this is the classic Vixie cron behaviour for restricted day fields.
 */

const MINUTE_MS = 60_000
const MINUTES_PER_DAY = 24 * 60
/** Finite eight-year-plus horizon covers the Gregorian 2100 leap-day gap. */
const MAX_SEARCH_DAYS = 8 * 366 + 2

export type CronSpec = Readonly<{
  minutes: ReadonlySet<number>
  hours: ReadonlySet<number>
  daysOfMonth: ReadonlySet<number>
  months: ReadonlySet<number>
  daysOfWeek: ReadonlySet<number>
  dayOfMonthRestricted: boolean
  dayOfWeekRestricted: boolean
}>

const FIELD_RANGES: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7]
]

function parseField(raw: string, min: number, max: number): Set<number> | null {
  const values = new Set<number>()
  for (const part of raw.split(',')) {
    const token = part.trim()
    if (!token) return null
    const [rangeText, stepText, ...rest] = token.split('/')
    if (rest.length > 0) return null
    if (stepText !== undefined && !/^\d+$/.test(stepText)) return null
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) return null
    let start: number
    let end: number
    if (rangeText === '*') {
      start = min
      end = max
    } else if (rangeText?.includes('-')) {
      const [from, to, ...extra] = rangeText.split('-')
      if (extra.length > 0 || !/^\d+$/.test(from ?? '') || !/^\d+$/.test(to ?? '')) return null
      start = Number(from)
      end = Number(to)
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    } else {
      if (!/^\d+$/.test(rangeText ?? '')) return null
      start = Number(rangeText)
      end = stepText === undefined ? start : max
      if (!Number.isInteger(start)) return null
    }
    if (start < min || end > max || start > end) return null
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values.size > 0 ? values : null
}

export function parseCronExpression(expression: string): CronSpec | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const parsed: Set<number>[] = []
  for (const [index, field] of fields.entries()) {
    const [min, max] = FIELD_RANGES[index]!
    const values = parseField(field, min, max)
    if (!values) return null
    parsed.push(values)
  }
  const [minutes, hours, daysOfMonth, months, rawDaysOfWeek] = parsed as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>
  ]
  const daysOfWeek = new Set<number>()
  for (const value of rawDaysOfWeek) daysOfWeek.add(value === 7 ? 0 : value)
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    dayOfMonthRestricted: fields[2] !== '*',
    dayOfWeekRestricted: fields[4] !== '*'
  }
}

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null
}

function dayMatches(spec: CronSpec, date: Date): boolean {
  if (!spec.months.has(date.getMonth() + 1)) return false
  const dayOfMonth = spec.daysOfMonth.has(date.getDate())
  const dayOfWeek = spec.daysOfWeek.has(date.getDay())
  if (spec.dayOfMonthRestricted && spec.dayOfWeekRestricted) return dayOfMonth || dayOfWeek
  return dayOfMonth && dayOfWeek
}

function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * Next occurrence strictly after `from`, as an ISO string, or '' when the
 * expression is invalid or has no occurrence inside the search window.
 */
export function nextCronAt(expression: string, from: Date): string {
  const spec = parseCronExpression(expression)
  if (!spec || !Number.isFinite(from.getTime())) return ''
  let cursor = new Date(from.getTime() + MINUTE_MS)
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours(), cursor.getMinutes(), 0, 0)
  for (let day = 0; day <= MAX_SEARCH_DAYS; day += 1) {
    if (dayMatches(spec, cursor)) {
      const firstMinute = day === 0 ? minuteOfDay(cursor) : 0
      for (let slot = firstMinute; slot < MINUTES_PER_DAY; slot += 1) {
        const hour = Math.floor(slot / 60)
        const minute = slot % 60
        if (!spec.hours.has(hour) || !spec.minutes.has(minute)) continue
        const candidate = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate(),
          hour,
          minute,
          0,
          0
        )
        // Local-time policy: skip spring gaps; fire only the earlier instant of a
        // repeated autumn minute (Date's compatible disambiguation), once.
        if (candidate.getFullYear() !== cursor.getFullYear() ||
            candidate.getMonth() !== cursor.getMonth() || candidate.getDate() !== cursor.getDate() ||
            candidate.getHours() !== hour || candidate.getMinutes() !== minute ||
            candidate.getTime() <= from.getTime()) continue
        return candidate.toISOString()
      }
    }
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1, 0, 0, 0, 0)
  }
  return ''
}
