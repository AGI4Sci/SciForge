import { describe, expect, it } from 'vitest'
import { responsesToChatCompletions } from '../../packages/workers/model-router/src/response-compat'
import { BIOGYM_DESIGN_INPUT_JSON_SCHEMA } from './biogym-tool-schema-contract'

describe('BioGym provider-facing tool schema', () => {
  it('survives the Responses-to-chat provider sanitizer with operation and stage fields intact', () => {
    const converted = responsesToChatCompletions({
      model: 'sciforge-router',
      input: '请使用 BioGym 设计一个 80–100 aa 的 de novo protein scaffold。先生成 3 个 backbone，然后用 ProteinMPNN 设计 sequence，最后选择最好的 2 个候选用 Boltz-2 验证结构。每个阶段完成后分析结果，并在 Biology Room 展示候选。',
      tools: [{
        type: 'function',
        name: 'biogym_design',
        description: 'Run a BioGym protein design stage.',
        parameters: BIOGYM_DESIGN_INPUT_JSON_SCHEMA
      }]
    })
    const tools = converted.tools as Array<{
      function: { parameters: { properties: Record<string, unknown> } }
    }>
    const properties = tools[0]?.function.parameters.properties
    const stage = properties?.stage as { properties?: Record<string, unknown> } | undefined

    expect(properties).toBeDefined()
    expect(Object.keys(properties ?? {})).toEqual(expect.arrayContaining([
      'operation', 'workflow', 'objective', 'designRunId', 'expectedRevision', 'stage'
    ]))
    expect(Object.keys(stage?.properties ?? {})).toEqual(expect.arrayContaining([
      'kind', 'lengthRange', 'numBackbones', 'backboneAssetId', 'candidateSetId'
    ]))
  })
})
