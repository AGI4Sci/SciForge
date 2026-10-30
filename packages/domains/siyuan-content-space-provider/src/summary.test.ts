import { describe, expect, it } from 'vitest'
import { renderSciForgeTaskSummary } from './summary.js'

describe('SciForge task summaries', () => {
  it('renders a bounded structured Markdown summary', () => {
    const markdown = renderSciForgeTaskSummary({
      title: '完成内置思源联动', completedAt: '2026-10-18T12:00:00.000Z',
      goal: '自动保存任务总结', result: '已完成'
    })
    expect(markdown).toContain('# 本轮总结：完成内置思源联动')
    expect(markdown).toContain('## 本轮结果\n已完成')
    expect(markdown).toContain('- 来源：SciForge')
  })

})
