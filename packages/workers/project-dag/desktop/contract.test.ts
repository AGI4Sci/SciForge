import { describe, expect, it } from 'vitest'
import { projectDagUiUrl } from './contract'

describe('Project DAG desktop contract', () => {
  it('builds embedded UI URLs with normalized service URLs and token hashes', () => {
    expect(projectDagUiUrl({
      serviceUrl: 'http://127.0.0.1:3898/',
      apiKey: ' project-token ',
      view: 'graph',
      embed: true,
      workspaceRoot: '/tmp/project alpha',
      projectRoot: '/tmp/project alpha',
      project: 'project-alpha',
      sessionIds: ['codex:thread-1', '']
    })).toBe('http://127.0.0.1:3898/?view=graph&embed=1&workspaceRoot=%2Ftmp%2Fproject+alpha&projectRoot=%2Ftmp%2Fproject+alpha&project=project-alpha&session=codex%3Athread-1#token=project-token')
  })
})
