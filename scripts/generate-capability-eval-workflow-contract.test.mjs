import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createWorkflowDefinitions } from './generate-capability-eval-workflow-expansion.mjs'
import { validateWorkflowMapping } from './generate-capability-eval-execution-plan.mjs'

const actionPlans = (await readFile(new URL('../eval-cases/capability/action-directed-plan.jsonl', import.meta.url), 'utf8'))
  .split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
const definitions = createWorkflowDefinitions(actionPlans)

function sample() {
  return {
    canonical: structuredClone(definitions.entries),
    plans: structuredClone(definitions.entries),
    cases: structuredClone(definitions.cases)
  }
}

function validate({ plans, cases, canonical }) {
  return validateWorkflowMapping(plans, cases, canonical)
}

test('current canonical definitions have 39 cases (18/9/12) and exact executable projection', () => {
  assert.equal(definitions.entries.length, 39)
  assert.deepEqual(validate(sample()), { 'same-domain': 18, 'cross-domain': 9, 'recovery-boundary': 12 })
  assert.ok(!definitions.entries.some((entry) => entry.template === 'dataset-to-plot'))
  assert.ok(!definitions.entries.some((entry) => ['research-to-compute', 'compute-to-plot'].includes(entry.template)))
  const input = structuredClone(actionPlans)
  assert.deepEqual(createWorkflowDefinitions(input.reverse()), definitions)
  assert.deepEqual(input, structuredClone(actionPlans).reverse(), 'factory does not mutate caller input')
})

test('future canonical templates and dynamic lengths are accepted without frozen counts', () => {
  for (const delta of [-1, 1, 3]) {
    const data = sample()
    if (delta < 0) {
      data.canonical.shift()
      data.plans.shift()
      data.cases.shift()
    } else {
      for (let index = 0; index < delta; index += 1) {
        const entry = { ...structuredClone(data.canonical[0]), id: `future-template-${index}`, template: `future-${index}`, requiredActions: ['future-owner.perform'] }
        data.canonical.push(entry)
        data.plans.push(structuredClone(entry))
        data.cases.push({ id: entry.id, query: 'Run a future workflow', expected: { requiredActions: entry.requiredActions } })
      }
    }
    // A future definition may change ID, category and selected actions as well as template count.
    data.canonical[0].id = data.plans[0].id = data.cases[0].id = 'future-renamed'
    data.canonical[0].category = data.plans[0].category = 'cross-domain'
    data.canonical[0].requiredActions = data.plans[0].requiredActions = data.cases[0].expected.requiredActions = ['future-owner.changed']
    assert.doesNotThrow(() => validate(data))
    assert.equal(Object.values(validate(data)).reduce((sum, count) => sum + count, 0), definitions.entries.length + delta)
  }
})

test('missing and unknown categories fail closed', () => {
  for (const category of [undefined, '', 'unknown']) {
    const data = sample()
    data.plans[0].category = category
    assert.throws(() => validate(data), /Unknown workflow category/u)
  }
  const data = sample()
  data.plans = data.plans.filter((entry) => entry.category !== 'cross-domain')
  assert.throws(() => validate(data), /Missing cross-domain/u)
  assert.throws(() => validateWorkflowMapping([], [], []), /must not be empty/u)
})

test('duplicate and empty IDs fail for canonical, plan and executable sides', () => {
  for (const side of ['canonical', 'plans', 'cases']) {
    const duplicate = sample()
    duplicate[side][0].id = duplicate[side][1].id
    assert.throws(() => validate(duplicate), /Duplicate/u)
    for (const id of [undefined, null, '', '   ']) {
      const empty = sample()
      empty[side][0].id = id
      assert.throws(() => validate(empty), /Empty/u)
    }
  }
})

test('plan and executable IDs must exactly match canonical, regardless of ordering', () => {
  const reordered = sample()
  reordered.plans.reverse()
  reordered.cases.reverse()
  assert.doesNotThrow(() => validate(reordered))
  for (const side of ['plans', 'cases']) {
    const data = sample()
    data[side][0].id = 'unplanned-id'
    assert.throws(() => validate(data), /no canonical definition/u)
    data[side].pop()
    assert.throws(() => validate(data), /case count/u)
  }
  const data = sample()
  data.plans[0].category = 'cross-domain'
  assert.throws(() => validate(data), /category/u)
})

test('requiredActions cannot be absent, empty IDs, duplicate, swapped or mismatched', () => {
  for (const side of ['plans', 'cases']) {
    for (const requiredActions of [undefined, [''], ['action', 'action'], ['unplanned-action'], []]) {
      const data = sample()
      if (side === 'plans') data.plans[0].requiredActions = requiredActions
      else data.cases[0].expected.requiredActions = requiredActions
      assert.throws(() => validate(data), /requiredActions|Empty|Duplicate/u)
    }
  }
  const data = sample()
  ;[data.cases[0].expected.requiredActions, data.cases[1].expected.requiredActions] = [data.cases[1].expected.requiredActions, data.cases[0].expected.requiredActions]
  assert.throws(() => validate(data), /requiredActions/u)
})

test('both projections losing the same required canonical template is rejected', () => {
  const data = sample()
  const missingId = data.canonical.find((entry) => entry.template === 'write-and-readback').id
  data.plans = data.plans.filter((entry) => entry.id !== missingId)
  data.cases = data.cases.filter((entry) => entry.id !== missingId)
  assert.throws(() => validate(data), /canonical workflow case count/u)
  // Replacing the lost case on both sides with an invented case cannot hide the loss either.
  data.plans.push({ ...data.plans[0], id: 'replacement' })
  data.cases.push({ ...data.cases[0], id: 'replacement' })
  assert.throws(() => validate(data), /no canonical definition/u)
})

test('matching plan and executable actions cannot jointly omit canonical actions', () => {
  const data = sample()
  data.plans[0].requiredActions = []
  data.cases[0].expected.requiredActions = []
  assert.throws(() => validate(data), /requiredActions/u)
})

test('missing cross-domain owner actions block any owner, not only plotting', () => {
  const readyPlans = actionPlans.map((plan) => ({ ...plan, fixture: { status: 'ready' }, oracle: { status: 'ready' } }))
  const allReady = createWorkflowDefinitions(readyPlans)
  const template = allReady.entries.find((entry) => entry.template === 'artifact-to-preview')
  assert.equal(template.readiness, 'ready')
  for (const missingOwner of template.packageOwners) {
    for (const mode of ['absent', '', ' ', undefined, null]) {
      const plans = mode === 'absent'
        ? readyPlans.filter((plan) => plan.owner !== missingOwner)
        : readyPlans.map((plan) => plan.owner === missingOwner ? { ...plan, actionId: mode } : plan)
      const { entries } = createWorkflowDefinitions(plans)
      const entry = entries.find((candidate) => candidate.template === template.template)
      assert.equal(entry.readiness, 'blocked')
      assert.equal(entry.blocker, `missing-owner: ${missingOwner}`)
      assert(!entry.requiredActions.some((actionId) => !actionId.trim()))
    }
  }
  const noCall = allReady.entries.find((entry) => entry.template === 'no-capability-call')
  assert.equal(noCall.readiness, 'ready')
  assert.deepEqual(noCall.requiredActions, [])
  const withoutPlotting = createWorkflowDefinitions(readyPlans.filter((plan) => plan.owner !== 'scientific-plotting'))
  for (const entry of withoutPlotting.entries.filter((entry) => entry.packageOwners.includes('scientific-plotting'))) {
    assert.equal(entry.readiness, 'blocked')
    assert.equal(entry.blocker, 'missing-owner: scientific-plotting')
  }
})

test('generator imports are silent and do not modify generated outputs', async () => {
  const outputs = [
    '../eval-cases/capability/workflow-expansion-plan.jsonl',
    '../eval-cases/capability/workflow-expansion-cases.jsonl',
    '../docs/generated/capability-workflow-expansion-plan.md',
    '../eval-cases/capability/full-execution-plan.json',
    '../docs/generated/capability-full-execution-plan.md'
  ].map((file) => new URL(file, import.meta.url))
  const before = await Promise.all(outputs.map((file) => readFile(file, 'utf8')))
  const script = ['execution-plan', 'workflow-expansion'].map((name) => `await import(${JSON.stringify(new URL(`./generate-capability-eval-${name}.mjs`, import.meta.url).href)})`).join(';')
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.deepEqual(await Promise.all(outputs.map((file) => readFile(file, 'utf8'))), before)
})
