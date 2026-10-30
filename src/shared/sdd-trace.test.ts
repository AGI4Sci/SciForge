import { describe, expect, it } from 'vitest'
import {
  applySddDerivedStatuses,
  buildSddTraceSnapshot,
  computeSddCoverage,
  deriveSddStatuses,
  diffSddRequirementChanges,
  parseSddPlanCovers,
  parseSddRequirementBlocks,
  setSddRequirementStatus
} from './sdd-trace'

const DRAFT = [
  '# Export requirement',
  '',
  '### R-1: Toolbar export {planned}',
  'User can see the export entry.',
  '- [ ] Button is visible',
  '- [x] Disabled state has a tooltip',
  '',
  '### R-2: Complete CSV',
  '',
  '```md',
  '### R-9: fake fenced heading {done}',
  '```',
  '',
  '- [ ] Includes every column',
  '',
  '## Notes',
  ''
].join('\n')

const PLAN = [
  '# Plan',
  '- [x] Add the export button (covers: R-1)',
  '- [ ] Add disabled tooltip (covers: R-1)',
  '- [x] Export all columns（covers: R-2, R-1）',
  '- [ ] Miscellaneous step',
  ''
].join('\n')

describe('sdd trace parsing', () => {
  it('parses requirement blocks and acceptance items', () => {
    const blocks = parseSddRequirementBlocks(DRAFT)
    expect(blocks.map((block) => block.id)).toEqual(['R-1', 'R-2'])
    expect(blocks[0]).toMatchObject({
      title: 'Toolbar export',
      status: 'planned',
      headingLevel: 3
    })
    expect(blocks[0].acceptance).toEqual([
      { text: 'Button is visible', checked: false, lineIndex: 4 },
      { text: 'Disabled state has a tooltip', checked: true, lineIndex: 5 }
    ])
    expect(blocks[1].status).toBe('draft')
    expect(blocks.some((block) => block.id === 'R-9')).toBe(false)
  })

  it('rewrites requirement status with a minimal line edit', () => {
    const next = setSddRequirementStatus(DRAFT, 'R-2', 'building')
    expect(next).toContain('### R-2: Complete CSV {building}')
    expect(next).toContain('### R-1: Toolbar export {planned}')
    expect(next.split('\n')).toHaveLength(DRAFT.split('\n').length)
  })

  it('parses covers tags and computes progress', () => {
    const items = parseSddPlanCovers(PLAN)
    expect(items).toHaveLength(3)
    expect(items[2]).toMatchObject({
      requirementIds: ['R-2', 'R-1'],
      checked: true,
      text: 'Export all columns'
    })
    const coverage = computeSddCoverage(parseSddRequirementBlocks(DRAFT), items)
    expect(coverage.perRequirement).toEqual([
      { id: 'R-1', totalSteps: 3, doneSteps: 2 },
      { id: 'R-2', totalSteps: 1, doneSteps: 1 }
    ])
    expect(coverage.uncoveredIds).toEqual([])
  })

  it('derives forward-only requirement statuses', () => {
    const blocks = parseSddRequirementBlocks(DRAFT)
    const coverage = computeSddCoverage(blocks, parseSddPlanCovers(PLAN)).perRequirement
    expect(deriveSddStatuses(blocks, coverage)).toEqual({ 'R-1': 'building', 'R-2': 'done' })
    const next = applySddDerivedStatuses(DRAFT, deriveSddStatuses(blocks, coverage))
    expect(next).toContain('R-1: Toolbar export {building}')
    expect(next).toContain('R-2: Complete CSV {done}')
  })

  it('detects requirement drift while ignoring status-only changes', () => {
    const snapshot = buildSddTraceSnapshot(DRAFT, '.sciforge/plan/sdd-x.md')
    const statusOnly = setSddRequirementStatus(DRAFT, 'R-1', 'done')
    expect(diffSddRequirementChanges(statusOnly, snapshot).changedIds).toEqual([])

    const edited = `${DRAFT.replace('User can see the export entry.', 'Entry moved into the menu.')}\n### R-3: New thing\n- [ ] New acceptance\n`
    expect(diffSddRequirementChanges(edited, snapshot)).toEqual({
      changedIds: ['R-1'],
      addedIds: ['R-3']
    })
  })
})
