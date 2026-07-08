import { describe, expect, it } from 'vitest'
import { projectDagUiUrl } from './contract'

describe('Project DAG desktop contract', () => {
  it('builds embedded UI URLs with normalized service URLs and token hashes', () => {
    expect(projectDagUiUrl({
      serviceUrl: 'http://127.0.0.1:3898/',
      apiKey: ' project-token ',
      view: 'graph',
      embed: true
    })).toBe('http://127.0.0.1:3898/?view=graph&embed=1#token=project-token')
  })
})
