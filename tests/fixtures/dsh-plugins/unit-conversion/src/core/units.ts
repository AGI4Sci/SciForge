/**
 * Unit conversion with explicit units and dimension checks.
 *
 * Design rules that make the answers trustworthy:
 *
 *  - Every unit is either a pure scale (`factor` to the dimension's base unit) or,
 *    for temperature, an affine map to kelvin. Mixing two dimensions is refused
 *    instead of silently producing a number.
 *  - Lookup is case-insensitive against the unit id, with an explicit alias table
 *    for the common spellings. `mL` and `ml` are the same unit; `m` (metre) and
 *    `M` (molar) are not both defined, so nothing silently changes meaning.
 *  - The result carries the exact (k, b) it used, so a caller can reproduce it:
 *    `to = from * k + b`.
 *  - Non-finite input is refused: NaN and Infinity are not results.
 */

export type UnitDimension = 'length' | 'mass' | 'time' | 'volume' | 'energy' | 'pressure' | 'temperature'

export type Rational = Readonly<{ n: number; d: number }>

export type UnitDefinition = Readonly<{
  id: string
  dimension: UnitDimension
  description: string
  /** Multiplier to the dimension's base unit. Absent for affine units. */
  factor?: number
  /**
   * Affine temperature, as exact rationals: kelvin = value * scale + offset,
   * with scale/offset carried as integer numerator/denominator so common
   * conversions stay exact (100 °C is exactly 212 °F, not 211.99999999999972).
   */
  affine?: Readonly<{ scale: Rational; offset: Rational }>
}>

export const UNITS: readonly UnitDefinition[] = Object.freeze([
  // length — base metre
  { id: 'm', dimension: 'length', description: 'metre', factor: 1 },
  { id: 'km', dimension: 'length', description: 'kilometre', factor: 1_000 },
  { id: 'cm', dimension: 'length', description: 'centimetre', factor: 0.01 },
  { id: 'mm', dimension: 'length', description: 'millimetre', factor: 0.001 },
  { id: 'um', dimension: 'length', description: 'micrometre', factor: 1e-6 },
  { id: 'nm', dimension: 'length', description: 'nanometre', factor: 1e-9 },
  { id: 'in', dimension: 'length', description: 'inch', factor: 0.0254 },
  { id: 'ft', dimension: 'length', description: 'foot', factor: 0.3048 },
  { id: 'yd', dimension: 'length', description: 'yard', factor: 0.9144 },
  { id: 'mi', dimension: 'length', description: 'mile', factor: 1_609.344 },
  // mass — base kilogram
  { id: 'kg', dimension: 'mass', description: 'kilogram', factor: 1 },
  { id: 'g', dimension: 'mass', description: 'gram', factor: 0.001 },
  { id: 'mg', dimension: 'mass', description: 'milligram', factor: 1e-6 },
  { id: 'ug', dimension: 'mass', description: 'microgram', factor: 1e-9 },
  { id: 't', dimension: 'mass', description: 'tonne', factor: 1_000 },
  { id: 'lb', dimension: 'mass', description: 'pound', factor: 0.45359237 },
  { id: 'oz', dimension: 'mass', description: 'ounce', factor: 0.028349523125 },
  // time — base second
  { id: 's', dimension: 'time', description: 'second', factor: 1 },
  { id: 'ms', dimension: 'time', description: 'millisecond', factor: 0.001 },
  { id: 'us', dimension: 'time', description: 'microsecond', factor: 1e-6 },
  { id: 'min', dimension: 'time', description: 'minute', factor: 60 },
  { id: 'h', dimension: 'time', description: 'hour', factor: 3_600 },
  { id: 'd', dimension: 'time', description: 'day', factor: 86_400 },
  // volume — base litre
  { id: 'L', dimension: 'volume', description: 'litre', factor: 1 },
  { id: 'mL', dimension: 'volume', description: 'millilitre', factor: 0.001 },
  { id: 'uL', dimension: 'volume', description: 'microlitre', factor: 1e-6 },
  { id: 'm3', dimension: 'volume', description: 'cubic metre', factor: 1_000 },
  { id: 'gal_us', dimension: 'volume', description: 'US gallon', factor: 3.785411784 },
  { id: 'fl_oz_us', dimension: 'volume', description: 'US fluid ounce', factor: 0.0295735295625 },
  // energy — base joule
  { id: 'J', dimension: 'energy', description: 'joule', factor: 1 },
  { id: 'kJ', dimension: 'energy', description: 'kilojoule', factor: 1_000 },
  { id: 'cal', dimension: 'energy', description: 'thermochemical calorie', factor: 4.184 },
  { id: 'kcal', dimension: 'energy', description: 'kilocalorie', factor: 4_184 },
  { id: 'Wh', dimension: 'energy', description: 'watt hour', factor: 3_600 },
  { id: 'kWh', dimension: 'energy', description: 'kilowatt hour', factor: 3_600_000 },
  { id: 'eV', dimension: 'energy', description: 'electronvolt', factor: 1.602176634e-19 },
  // pressure — base pascal
  { id: 'Pa', dimension: 'pressure', description: 'pascal', factor: 1 },
  { id: 'kPa', dimension: 'pressure', description: 'kilopascal', factor: 1_000 },
  { id: 'MPa', dimension: 'pressure', description: 'megapascal', factor: 1e6 },
  { id: 'bar', dimension: 'pressure', description: 'bar', factor: 1e5 },
  { id: 'mbar', dimension: 'pressure', description: 'millibar', factor: 100 },
  { id: 'atm', dimension: 'pressure', description: 'standard atmosphere', factor: 101_325 },
  { id: 'mmHg', dimension: 'pressure', description: 'millimetre of mercury', factor: 133.322387415 },
  // temperature — affine, base kelvin
  // K = v; C = v + 273.15; F = (v - 32)·5/9 + 273.15; R = v·5/9, all as exact rationals.
  { id: 'K', dimension: 'temperature', description: 'kelvin', affine: { scale: { n: 1, d: 1 }, offset: { n: 0, d: 1 } } },
  { id: 'C', dimension: 'temperature', description: 'degree Celsius', affine: { scale: { n: 1, d: 1 }, offset: { n: 27315, d: 100 } } },
  { id: 'F', dimension: 'temperature', description: 'degree Fahrenheit', affine: { scale: { n: 5, d: 9 }, offset: { n: 229835, d: 900 } } },
  { id: 'R', dimension: 'temperature', description: 'degree Rankine', affine: { scale: { n: 5, d: 9 }, offset: { n: 0, d: 1 } } }
])

/** Extra spellings, deliberately explicit so nothing changes meaning by accident. */
export const UNIT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  meter: 'm', metre: 'm', meters: 'm', metres: 'm',
  centimeter: 'cm', centimetre: 'cm', millimeter: 'mm', millimetre: 'mm',
  micrometer: 'um', micrometre: 'um', nanometer: 'nm', nanometre: 'nm',
  inch: 'in', inches: 'in', foot: 'ft', feet: 'ft', yard: 'yd', yards: 'yd', mile: 'mi', miles: 'mi',
  kilogram: 'kg', kilograms: 'kg', gram: 'g', grams: 'g', milligram: 'mg', milligrams: 'mg',
  microgram: 'ug', micrograms: 'ug', tonne: 't', tonnes: 't', ton: 't',
  pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz',
  sec: 's', secs: 's', second: 's', seconds: 's', millisecond: 'ms', ms_ok: 'ms',
  minute: 'min', minutes: 'min', hour: 'h', hours: 'h', hr: 'h', hrs: 'h', day: 'd', days: 'd',
  litre: 'L', liter: 'L', litres: 'L', liters: 'L', millilitre: 'mL', milliliter: 'mL',
  cubicmetre: 'm3', cubicmeter: 'm3',
  joule: 'J', joules: 'J', kilojoule: 'kJ', calorie: 'cal', calories: 'cal',
  kilocalorie: 'kcal', kilocalories: 'kcal', watthour: 'Wh', kilowatthour: 'kWh', electronvolt: 'eV',
  pascal: 'Pa', kilopascal: 'kPa', megapascal: 'MPa', millibar: 'mbar', atmosphere: 'atm', torr: 'mmHg',
  celsius: 'C', centigrade: 'C', fahrenheit: 'F', kelvin: 'K', rankine: 'R'
})

/**
 * Decimal factors become exact rationals: `0.3048` is `3048/10000`, so
 * `3 ft → in` is exactly 36 rather than 36.00000000000001. Factors that have no
 * short exact decimal form (the electronvolt) keep double precision, which the
 * README states plainly.
 */
export function toRational(value: number): Rational {
  for (let exponent = 0; exponent <= 30; exponent += 1) {
    const scaled = value * 10 ** exponent
    if (!Number.isFinite(scaled)) break
    const rounded = Math.round(scaled)
    if (Math.abs(scaled - rounded) <= Math.abs(scaled) * 1e-12) return { n: rounded, d: 10 ** exponent }
  }
  return { n: value, d: 1 }
}

const RATIONAL_FACTORS = new Map<string, Rational>()
for (const unit of UNITS) {
  if (typeof unit.factor === 'number') RATIONAL_FACTORS.set(unit.id, toRational(unit.factor))
}

const BY_KEY = new Map<string, UnitDefinition>()
for (const unit of UNITS) BY_KEY.set(unit.id.toLowerCase(), unit)
for (const [alias, id] of Object.entries(UNIT_ALIASES)) {
  const unit = UNITS.find((candidate) => candidate.id === id)
  if (unit) BY_KEY.set(alias.toLowerCase(), unit)
}

export class UnitConversionError extends Error {
  readonly code: 'unknown_unit' | 'incompatible_dimensions' | 'invalid_request'

  constructor(code: 'unknown_unit' | 'incompatible_dimensions' | 'invalid_request', message: string) {
    super(message)
    this.name = 'UnitConversionError'
    this.code = code
  }
}

export type Conversion = Readonly<{
  value: number
  from: string
  to: string
  dimension: UnitDimension
  /** to = from * k + b — the exact transform used. */
  k: number
  b: number
  /** 12 significant digits, for display; `value` is the unrounded result. */
  formatted: string
}>

function lookup(input: unknown, role: 'from' | 'to'): UnitDefinition {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new UnitConversionError('invalid_request', `Provide \`${role}\` as a unit id such as "m", "kg", "C" or "L".`)
  }
  const unit = BY_KEY.get(input.trim().toLowerCase())
  if (!unit) {
    const known = UNITS.map((candidate) => candidate.id).sort().join(', ')
    throw new UnitConversionError('unknown_unit', `Unknown unit "${input}". Supported units: ${known}.`)
  }
  return unit
}

/**
 * Temperature: kelvin = value·scale + offset, and the target is
 * `(kelvin - offsetTo) / scaleTo`. Everything is arranged as integer numerator
 * and denominator first and divided once, so integer inputs come out exact.
 */
function convertAffine(
  value: number,
  from: NonNullable<UnitDefinition['affine']>,
  to: NonNullable<UnitDefinition['affine']>
): number {
  const numerator = (value * from.scale.n * from.offset.d + from.offset.n * from.scale.d) * to.offset.d -
    to.offset.n * from.scale.d * from.offset.d
  const denominator = from.scale.d * from.offset.d * to.offset.d
  // Fold the target's scale into the same single division: dividing first and
  // scaling afterwards re-introduces the rounding this path exists to avoid.
  return (numerator * to.scale.d) / (denominator * to.scale.n)
}

/** k and b for `to = from * k + b`, derived through the same exact path. */
function linearTransform(from: UnitDefinition, to: UnitDefinition): Readonly<{ k: number; b: number }> {
  if (from.affine && to.affine) {
    // Evaluate the same transform at 0 and 1: b = f(0), k = f(1) - f(0).
    const b = convertAffine(0, from.affine, to.affine)
    const k = convertAffine(1, from.affine, to.affine) - b
    return { k, b }
  }
  const fromFactor = RATIONAL_FACTORS.get(from.id)
  const toFactor = RATIONAL_FACTORS.get(to.id)
  if (fromFactor === undefined || toFactor === undefined) {
    throw new UnitConversionError('invalid_request', 'Internal unit definition is incomplete.')
  }
  return { k: (fromFactor.n * toFactor.d) / (fromFactor.d * toFactor.n), b: 0 }
}

export function convert(input: unknown): Conversion {
  const request = (input ?? {}) as { value?: unknown; from?: unknown; to?: unknown }
  const value = request.value
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UnitConversionError('invalid_request', 'Provide `value` as a finite number.')
  }
  const from = lookup(request.from, 'from')
  const to = lookup(request.to, 'to')
  if (from.dimension !== to.dimension) {
    throw new UnitConversionError(
      'incompatible_dimensions',
      `Cannot convert ${from.id} (${from.dimension}) to ${to.id} (${to.dimension}).`
    )
  }
  const { k, b } = linearTransform(from, to)
  const fromFactor = RATIONAL_FACTORS.get(from.id)
  const toFactor = RATIONAL_FACTORS.get(to.id)
  const converted = from.affine && to.affine
    ? convertAffine(value, from.affine, to.affine)
    : fromFactor && toFactor
      // Multiply first, divide once: keeps exact results for exact factors.
      ? (value * fromFactor.n * toFactor.d) / (fromFactor.d * toFactor.n)
      : value * k + b
  if (!Number.isFinite(converted)) {
    throw new UnitConversionError('invalid_request', 'The converted value is not finite.')
  }
  return Object.freeze({
    value: converted,
    from: from.id,
    to: to.id,
    dimension: from.dimension as UnitDimension,
    k,
    b,
    formatted: Number(converted.toPrecision(12)).toString()
  })
}

export function listUnits(): readonly Readonly<{ dimension: UnitDimension; units: readonly UnitDefinition[] }>[] {
  const dimensions = [...new Set(UNITS.map((unit) => unit.dimension))]
  return Object.freeze(dimensions.map((dimension) => Object.freeze({
    dimension,
    units: Object.freeze(UNITS.filter((unit) => unit.dimension === dimension))
  })))
}

/** Worked examples that ship with the plugin, so the behaviour is checkable. */
export const UNIT_CONVERSION_EXAMPLES: readonly Readonly<{ from: string; to: string; value: number; expected: number }>[] = Object.freeze([
  { from: 'km', to: 'm', value: 1, expected: 1_000 },
  { from: 'lb', to: 'kg', value: 1, expected: 0.45359237 },
  { from: 'kcal', to: 'kJ', value: 1, expected: 4.184 },
  { from: 'C', to: 'F', value: 100, expected: 212 }
])