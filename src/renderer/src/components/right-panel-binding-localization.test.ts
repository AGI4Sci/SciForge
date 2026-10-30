import { describe, expect, it } from 'vitest'
import enCommon from '../locales/en/common.json'
import zhCommon from '../locales/zh/common.json'

const expectedHostLabels = {
  rightPanelTodos: ['Todos', '待办事项'],
  filePreviewTitle: ['File preview', '文件预览'],
  rightPanelPlan: ['Plan', '计划'],
  rightPanelSddAssistant: ['SDD assistant', 'SDD 助手'],
  rightPanelChildAgents: ['Child agents', '子智能体']
} as const

const pluginTitles = [
  'Native browser',
  'Change Inspector',
  'Collaboration',
  'Create Loop',
  'Paper radar',
  'Project DAG',
  'Remote targets',
  'Git Checkpoints',
  'Scientific Plot Provenance',
  'Evidence DAG',
  'Research',
  'Content Space'
] as const

describe('right-panel binding localization', () => {
  it('keeps only host-owned right-panel labels in the host locale bundle', () => {
    for (const [key, [english, chinese]] of Object.entries(expectedHostLabels)) {
      expect(enCommon[key as keyof typeof enCommon], `missing English label for ${key}`).toBe(english)
      expect(zhCommon[key as keyof typeof zhCommon], `missing Chinese label for ${key}`).toBe(chinese)
    }
    for (const title of pluginTitles) {
      expect(enCommon).not.toHaveProperty(title)
      expect(zhCommon).not.toHaveProperty(title)
    }
  })
})
