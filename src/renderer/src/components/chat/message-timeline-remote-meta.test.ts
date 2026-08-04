import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { ToolBlock } from '../../agent/types'
import { MessageBubble } from './message-timeline-bubbles'
import { summarizeToolBlock } from './message-timeline-process'

describe('timeline remote tool metadata', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('adds remote metadata to tool summaries from flat meta fields', () => {
    const block: ToolBlock = {
      kind: 'tool',
      id: 'tool-1',
      status: 'running',
      toolKind: 'command_execution',
      summary: 'bash: sbatch run.sh',
      meta: {
        workspaceHostLabel: 'GPU workspace',
        targetId: 'opaque-gpu-host',
        mode: 'slurm',
        trusted: true,
        jobId: '1234',
        status: 'queued'
      }
    }

    const summary = summarizeToolBlock(block, (key, opts) => i18n.t(`common:${key}`, opts))

    expect(summary).toContain('target GPU workspace')
    expect(summary).not.toContain('opaque-gpu-host')
    expect(summary).toContain('slurm')
    expect(summary).toContain('Trusted')
    expect(summary).toContain('queued')
  })

  it('renders remote chips on tool bubbles from nested remote meta', () => {
    const block: ToolBlock = {
      kind: 'tool',
      id: 'tool-2',
      status: 'success',
      toolKind: 'command_execution',
      summary: 'Submitted remote job',
      meta: {
        remote: {
          displayLabel: 'GPU workspace',
          targetId: 'opaque-gpu-host',
          mode: 'slurm',
          trusted: false,
          runId: 'run-7',
          jobId: '1234',
          status: 'running'
        }
      }
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('Target GPU workspace')
    expect(html).not.toContain('opaque-gpu-host')
    expect(html).toContain('Untrusted')
    expect(html).toContain('Run run-7')
    expect(html).toContain('Job 1234')
    expect(html).toContain('running')
  })
})
