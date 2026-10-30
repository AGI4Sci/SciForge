import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCHEDULE_TOOL_SIDE_EFFECTS,
  scheduleCreateToolInputSchema,
  scheduleDeleteToolInputSchema,
  scheduleRunToolInputSchema,
  scheduleTaskResourceUri,
  scheduleToolSideEffectContractSchema,
  scheduleUpdateToolInputSchema
} from './contract.js'

test('schedule create schema validates schedule-specific required fields', () => {
  assert.equal(scheduleCreateToolInputSchema.safeParse({
    title: 'Morning notes',
    prompt: 'Summarize yesterday.',
    schedule_kind: 'daily',
    time_of_day: '09:00'
  }).success, true)

  const missingInterval = scheduleCreateToolInputSchema.safeParse({
    title: 'Poll',
    prompt: 'Check status.',
    schedule_kind: 'interval'
  })
  assert.equal(missingInterval.success, false)
  assert.match(String(missingInterval.error), /every_minutes/)

  const badDailyTime = scheduleCreateToolInputSchema.safeParse({
    title: 'Bad clock',
    prompt: 'Run it.',
    schedule_kind: 'daily',
    time_of_day: '25:00'
  })
  assert.equal(badDailyTime.success, false)
})

test('schedule update schema requires a task id and at least one patch field', () => {
  assert.equal(scheduleUpdateToolInputSchema.safeParse({
    task_id: 'task-1',
    enabled: false
  }).success, true)

  const missingPatch = scheduleUpdateToolInputSchema.safeParse({ task_id: 'task-1' })
  assert.equal(missingPatch.success, false)
  assert.match(String(missingPatch.error), /At least one update field/)
})

test('schedule side-effect contract matches write control schemas', () => {
  for (const contract of Object.values(SCHEDULE_TOOL_SIDE_EFFECTS)) {
    assert.equal(scheduleToolSideEffectContractSchema.safeParse(contract).success, true)
  }

  assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_list.effect, 'read-only')
  assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_status.effect, 'read-only')
  assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_create.effect, 'write')
  assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_update.effect, 'write')
  assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_detect_from_text.effect, 'write')
  assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_delete.effect, 'destructive')
  assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_run.effect, 'destructive')

  assert.equal(scheduleCreateToolInputSchema.safeParse({
    title: 'Dry create',
    prompt: 'Do work.',
    schedule_kind: 'interval',
    every_minutes: 5,
    dry_run: true
  }).success, true)
  assert.equal(scheduleUpdateToolInputSchema.safeParse({
    task_id: 'task-1',
    title: 'Dry update',
    preview: true
  }).success, true)
  assert.equal(scheduleDeleteToolInputSchema.safeParse({
    task_id: 'task-1',
    dry_run: true,
    confirmation: 'delete:task-1'
  }).success, true)
  assert.equal(scheduleRunToolInputSchema.safeParse({
    task_id: 'task-1',
    confirmation: 'run:task-1'
  }).success, true)
})

test('schedule task resource uri encodes task ids', () => {
  assert.equal(scheduleTaskResourceUri('task/with space'), 'schedule://task/task%2Fwith%20space')
})
