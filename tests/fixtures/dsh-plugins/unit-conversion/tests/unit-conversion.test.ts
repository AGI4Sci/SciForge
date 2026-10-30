import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { convert, listUnits, UnitConversionError, UNIT_CONVERSION_EXAMPLES, UNITS } from '../src/core/units.js'
import { __internals, apply } from '../src/dsh-adapter/index.js'

const declaration = JSON.parse(
  await readFile(new URL('../sciforge.dsh.json', import.meta.url), 'utf8')
) as { tools: Record<string, { id: string; effect: string }> }

test('converts within a dimension', () => {
  assert.equal(convert({ value: 1, from: 'km', to: 'm' }).value, 1_000)
  assert.equal(convert({ value: 2_500, from: 'm', to: 'km' }).value, 2.5)
  assert.equal(convert({ value: 1, from: 'lb', to: 'kg' }).value, 0.45359237)
  assert.equal(convert({ value: 1, from: 'kcal', to: 'kJ' }).value, 4.184)
  assert.equal(convert({ value: 1, from: 'atm', to: 'Pa' }).value, 101_325)
})

test('temperature is affine, not a scale factor', () => {
  const freezing = convert({ value: 0, from: 'C', to: 'F' })
  assert.equal(freezing.value, 32)
  assert.equal(freezing.b, 32)
  assert.equal(convert({ value: 100, from: 'C', to: 'F' }).value, 212)
  assert.equal(convert({ value: 212, from: 'F', to: 'C' }).value, 100)
  assert.equal(convert({ value: 0, from: 'C', to: 'K' }).value, 273.15)
  assert.equal(convert({ value: 491.67, from: 'R', to: 'F' }).value, 32)
})

test('the returned k/b reproduce the result', () => {
  const conversion = convert({ value: 37, from: 'C', to: 'F' })
  // The reported k/b reproduce the value within double precision; the conversion
  // itself is computed through the exact rational path, so the value is exact.
  assert.ok(Math.abs(conversion.value - (37 * conversion.k + conversion.b)) < 1e-9)
  assert.equal(conversion.formatted, '98.6')
})

test('unit lookup accepts documented spellings but does not change meaning', () => {
  assert.equal(convert({ value: 1, from: 'meters', to: 'cm' }).value, 100)
  assert.equal(convert({ value: 1, from: 'ML', to: 'mL' }).value, 1)
  assert.equal(convert({ value: 1, from: 'celsius', to: 'F' }).value, 33.8)
})

test('refuses cross-dimension conversions', () => {
  assert.throws(() => convert({ value: 1, from: 'm', to: 'kg' }), (error: unknown) =>
    error instanceof UnitConversionError && error.code === 'incompatible_dimensions')
  assert.throws(() => convert({ value: 1, from: 'L', to: 's' }), /Cannot convert/)
})

test('refuses unknown units and lists what is supported', () => {
  assert.throws(() => convert({ value: 1, from: 'furlong', to: 'm' }), (error: unknown) =>
    error instanceof UnitConversionError && error.code === 'unknown_unit')
  assert.throws(() => convert({ value: 1, from: 'm', to: '' }), /Provide `to`/)
})

test('refuses non-finite values', () => {
  assert.throws(() => convert({ value: Number.NaN, from: 'm', to: 'cm' }), /finite/)
  assert.throws(() => convert({ value: Number.POSITIVE_INFINITY, from: 'm', to: 'cm' }), /finite/)
  assert.throws(() => convert({ value: '1' as never, from: 'm', to: 'cm' }), /finite/)
})

test('the tool layer returns structured errors instead of throwing', () => {
  const unknown = __internals.conversionResult({ value: 1, from: 'm', to: 'kg' })
  assert.equal(unknown.ok, false)
  assert.equal((unknown as { error: { code: string } }).error.code, 'incompatible_dimensions')

  const ok = __internals.conversionResult({ value: 3, from: 'ft', to: 'in' })
  assert.equal(ok.ok, true)
  assert.equal((ok as { result: { value: number } }).result.value, 36)
})

test('every unit is well formed and the examples hold', () => {
  for (const unit of UNITS) {
    if (unit.dimension === 'temperature') {
      assert.ok(unit.affine, `${unit.id} needs an affine definition`)
      assert.equal(typeof unit.affine?.scale.n, 'number', `${unit.id} scale numerator`)
      assert.equal(typeof unit.affine?.offset.d, 'number', `${unit.id} offset denominator`)
      assert.ok((unit.affine?.scale.d ?? 0) > 0 && (unit.affine?.offset.d ?? 0) > 0, `${unit.id} needs positive denominators`)
    } else {
      assert.equal(typeof unit.factor, 'number', `${unit.id} needs a factor`)
      assert.ok((unit.factor ?? 0) > 0, `${unit.id} must have a positive factor`)
    }
  }
  for (const example of UNIT_CONVERSION_EXAMPLES) {
    const conversion = convert({ value: example.value, from: example.from, to: example.to })
    assert.equal(conversion.value, example.expected, `${example.value} ${example.from} → ${example.to}`)
  }
  const dimensions = listUnits().map((entry) => entry.dimension)
  assert.deepEqual(dimensions, ['length', 'mass', 'time', 'volume', 'energy', 'pressure', 'temperature'])
})

test('registered tool names match the market declaration exactly', () => {
  const registered: { name: string }[] = []
  apply({ tools: { register: (tool: unknown) => registered.push(tool as { name: string }) } } as never)
  assert.deepEqual(
    registered.map((tool) => tool.name).sort(),
    Object.keys(declaration.tools).sort()
  )
  assert.deepEqual(registered.map((tool) => tool.name).sort(), ['unit_conversion_convert', 'unit_conversion_list'])
})

test('unexpected configuration fails closed', () => {
  assert.throws(() => apply({ tools: { register: () => undefined } } as never, { units: [] }), /takes no configuration/)
  apply({ tools: { register: () => undefined } } as never, {})
})