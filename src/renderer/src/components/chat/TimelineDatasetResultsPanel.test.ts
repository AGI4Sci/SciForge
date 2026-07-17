import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import {
  datasetResultsFromTimelineBlocks,
  datasetTextPreview,
  metadataHighlights,
  publicationReleaseFiles
} from './TimelineDatasetResultsPanel'

describe('TimelineDatasetResultsPanel', () => {
  it('extracts bounded Dataset API metadata persisted by the Codex runtime', () => {
    const blocks: ChatBlock[] = [{
      kind: 'tool',
      id: 'metadata-1',
      summary: 'mcp__sciforge_dataset_api__dataset_api_metadata',
      status: 'success',
      meta: {
        toolName: 'mcp__sciforge_dataset_api__dataset_api_metadata',
        datasetApi: {
          toolName: 'dataset_api_metadata',
          success: true,
          result: {
            source: { id: 'uniprot', name: 'UniProt REST' },
            response: { status: 200, bytes: 869335 },
            metadata: { primaryAccession: 'P04637', genes: [{ geneName: { value: 'TP53' } }] },
            metadataTruncated: true
          }
        }
      }
    }]

    const [result] = datasetResultsFromTimelineBlocks(blocks)
    expect(result).toMatchObject({
      toolName: 'dataset_api_metadata',
      kind: 'metadata',
      success: true,
      result: { metadata: { primaryAccession: 'P04637' } }
    })
  })

  it('extracts raw-data artifacts from structuredContent tool detail', () => {
    const structured = {
      result: {
        source: { id: 'ncbi-eutils', name: 'NCBI E-utilities' },
        response: { status: 200, bytes: 19431 },
        artifact: { path: '/workspace/tp53.fasta', format: 'fasta', sha256: 'abc' }
      }
    }
    const blocks: ChatBlock[] = [{
      kind: 'tool',
      id: 'raw-1',
      summary: 'dataset_api_raw_data',
      status: 'success',
      meta: { toolName: 'dataset_api_raw_data' },
      detail: `Downloaded raw data.\nstructuredContent:\n${JSON.stringify(structured)}`
    }]

    expect(datasetResultsFromTimelineBlocks(blocks)[0]).toMatchObject({
      kind: 'raw-data',
      result: { artifact: { path: '/workspace/tp53.fasta', format: 'fasta' } }
    })
  })

  it('extracts persisted MCP inputText content blocks', () => {
    const blocks: ChatBlock[] = [{
      kind: 'tool',
      id: 'persisted-uniprot',
      summary: 'dataset_api_metadata',
      status: 'success',
      detail: JSON.stringify([
        { type: 'inputText', text: 'Read metadata.' },
        {
          type: 'inputText',
          text: 'structuredContent:\n{"result":{"source":{"name":"UniProt REST"},"response":{"status":200,"bytes":490},"metadata":{"primaryAccession":"P04637"}}}'
        }
      ])
    }]

    expect(datasetResultsFromTimelineBlocks(blocks)).toMatchObject([{
      toolName: 'dataset_api_metadata',
      success: true,
      result: {
        source: { name: 'UniProt REST' },
        metadata: { primaryAccession: 'P04637' }
      }
    }])
  })

  it('unwraps local-runtime mcp_call receipts into Dataset plan cards', () => {
    const blocks: ChatBlock[] = [{
      kind: 'tool',
      id: 'wrapped-plan',
      summary: 'mcp_call',
      status: 'success',
      meta: {
        toolName: 'mcp_call',
        output: {
          serverId: 'dataset_api',
          toolName: 'dataset_prepare_plan',
          toolId: 'dataset_api/dataset_prepare_plan',
          result: {
            structuredContent: {
              result: {
                plan: { planId: 'plan-bfe4251c23fd1771', status: 'draft', confirmedByUser: false },
                artifact: { path: '/workspace/.sciforge/datasets/plans/plan-bfe4251c23fd1771.json' }
              }
            }
          }
        }
      }
    }]

    expect(datasetResultsFromTimelineBlocks(blocks)).toMatchObject([{
      toolName: 'dataset_prepare_plan',
      kind: 'plan',
      success: true,
      result: {
        plan: { planId: 'plan-bfe4251c23fd1771', status: 'draft' }
      }
    }])
  })

  it('extracts checkpointed plan execution progress for the conversation card', () => {
    const blocks: ChatBlock[] = [{
      kind: 'tool',
      id: 'execute-plan',
      summary: 'dataset_execute_plan',
      status: 'success',
      meta: {
        toolName: 'dataset_execute_plan',
        output: {
          structuredContent: {
            result: {
              execution: {
                runId: 'run-0123456789abcdef',
                planId: 'plan-0123456789abcdef',
                status: 'failed',
                completedSteps: 1,
                failedSteps: 1,
                totalSteps: 3,
                resumable: true,
                steps: [
                  { index: 0, tool: 'dataset_api_raw_data', status: 'succeeded', attempts: 1 },
                  { index: 1, tool: 'dataset_filter', status: 'failed', attempts: 1, error: 'network unavailable' }
                ]
              },
              artifact: { path: '/workspace/.sciforge/datasets/runs/run-0123456789abcdef.json', sha256: 'abc' }
            }
          }
        }
      }
    }]

    expect(datasetResultsFromTimelineBlocks(blocks)).toMatchObject([{
      toolName: 'dataset_execute_plan',
      kind: 'execution',
      success: true,
      result: {
        execution: {
          status: 'failed',
          resumable: true,
          completedSteps: 1
        }
      }
    }])
  })

  it('surfaces structured Dataset API failures and ignores unrelated tools', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool',
        id: 'error-1',
        summary: 'dataset_api_metadata',
        status: 'error',
        meta: {
          toolName: 'dataset_api_metadata',
          output: {
            structuredContent: {
              error: { code: 'DATASET_API_NETWORK_ERROR', message: 'DNS failed', retryable: true }
            }
          }
        }
      },
      {
        kind: 'tool',
        id: 'incomplete-dataset-result',
        summary: 'dataset_api_metadata',
        status: 'success',
        meta: { toolName: 'dataset_api_metadata' },
        detail: 'Read metadata bytes, but the historical structured payload was truncated.'
      },
      { kind: 'tool', id: 'bash-1', summary: 'bash', status: 'success', detail: 'ok' }
    ]

    expect(datasetResultsFromTimelineBlocks(blocks)).toEqual([
      expect.objectContaining({
        id: 'error-1',
        kind: 'metadata',
        success: false,
        error: expect.objectContaining({ code: 'DATASET_API_NETWORK_ERROR' })
      })
    ])
  })

  it('extracts useful biology fields from bounded UniProt metadata summaries', () => {
    expect(metadataHighlights({
      primaryAccession: 'P04637',
      organism: { scientificName: 'Homo sapiens' },
      genes: { sample: [{ geneName: { value: 'TP53' } }] },
      sequence: { length: 393 }
    })).toEqual([
      { label: 'Accession', value: 'P04637' },
      { label: 'Gene', value: 'TP53' },
      { label: 'Organism', value: 'Homo sapiens' },
      { label: 'Sequence', value: '393 aa' }
    ])
  })

  it('bounds FASTA and pretty-prints JSON raw-data previews', () => {
    const fasta = ['>sp|P04637|P53_HUMAN', ...Array.from({ length: 20 }, (_, index) => `SEQ${index}`)].join('\n')
    expect(datasetTextPreview(fasta, 'fasta', 'P04637.fasta').split('\n')).toHaveLength(10)
    expect(datasetTextPreview('{"id":"P04637","length":393}', 'json', 'P04637.json')).toContain(
      '\n  "length": 393\n'
    )
  })

  it('exposes every reproducible publication file to the conversation card', () => {
    expect(publicationReleaseFiles({
      manifestPath: '/release/manifest.json',
      schemaPath: '/release/schema.json',
      qualityReportPath: '/release/quality-report.json',
      preparationPlanPath: '/release/preparation-plan.json',
      checksumsPath: '/release/checksums.sha256'
    })).toEqual([
      { label: 'datasetResultOpenManifest', path: '/release/manifest.json' },
      { label: 'datasetResultOpenSchema', path: '/release/schema.json' },
      { label: 'datasetResultOpenQuality', path: '/release/quality-report.json' },
      { label: 'datasetResultOpenPlan', path: '/release/preparation-plan.json' },
      { label: 'datasetResultOpenChecksums', path: '/release/checksums.sha256' }
    ])
  })

  it('extracts processing, validation, and publication results with row-count evidence', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'tool', id: 'filter-1', summary: 'dataset_filter', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_filter', success: true,
          result: {
            counts: { inputRecords: 10, outputRecords: 4, excludedRecords: 6 },
            artifact: { path: '/workspace/filtered.tsv', format: 'tsv', bytes: 120, sha256: 'abc' }
          }
        } }
      },
      {
        kind: 'tool', id: 'id-map-1', summary: 'dataset_id_map', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_id_map', success: true,
          result: {
            counts: { inputRecords: 5, outputRecords: 6, mappedRecords: 4, unmatchedRecords: 1, ambiguousRecords: 1 },
            artifact: { path: '/workspace/mapped.tsv', format: 'tsv', bytes: 280, sha256: 'map' }
          }
        } }
      },
      {
        kind: 'tool', id: 'provider-map-1', summary: 'dataset_id_map_provider', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_id_map_provider', success: true,
          result: {
            counts: { inputRecords: 2, outputRecords: 2, mappedRecords: 2, unmatchedRecords: 0, ambiguousRecords: 0 },
            artifact: { path: '/workspace/provider-mapped.tsv', format: 'tsv', bytes: 180, sha256: 'provider-map' },
            providerJob: { jobId: 'job123', failedIdCount: 0 }
          }
        } }
      },
      {
        kind: 'tool', id: 'join-1', summary: 'dataset_join', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_join', success: true,
          result: {
            counts: { leftRecords: 4, rightRecords: 3, outputRecords: 5, unmatchedLeftRecords: 1, unmatchedRightRecords: 0 },
            artifact: { path: '/workspace/joined.tsv', format: 'tsv', bytes: 320, sha256: 'def' },
            unmatchedArtifacts: { left: { path: '/workspace/unmatched-left.json' }, right: { path: '/workspace/unmatched-right.json' } }
          }
        } }
      },
      {
        kind: 'tool', id: 'graph-1', summary: 'dataset_graph_organize', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_graph_organize', success: true,
          result: {
            counts: { inputRecords: 10, nodeRecords: 7, edgeRecords: 8, invalidRecords: 1, duplicateEdgesRemoved: 1 },
            graphArtifact: { path: '/workspace/network.graph.json', format: 'report', bytes: 240, sha256: 'graph' }
          }
        } }
      },
      {
        kind: 'tool', id: 'structure-profile-1', summary: 'dataset_structure_profile', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_structure_profile', success: true,
          result: { profile: { format: 'mmcif', records: 1, coordinateRecords: 2500 } }
        } }
      },
      {
        kind: 'tool', id: 'structure-validate-1', summary: 'dataset_structure_validate', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_structure_validate', success: true,
          result: { validation: { valid: true, records: 1, coordinateRecords: 2500, errorCount: 0 } }
        } }
      },
      {
        kind: 'tool', id: 'validate-1', summary: 'dataset_validate', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_validate', success: true,
          result: { validation: { valid: true, records: 4, errorCount: 0 } }
        } }
      },
      {
        kind: 'tool', id: 'publish-1', summary: 'dataset_publish', status: 'success',
        meta: { datasetApi: {
          toolName: 'dataset_publish', success: true,
          result: {
            publication: { artifactCount: 2, manifestPath: '/workspace/published/manifest.json' },
            quality: { status: 'passed' }
          }
        } }
      }
    ]

    expect(datasetResultsFromTimelineBlocks(blocks)).toMatchObject([
      { kind: 'processing', result: { counts: { outputRecords: 4 } } },
      { kind: 'processing', toolName: 'dataset_id_map', result: { counts: { mappedRecords: 4, ambiguousRecords: 1 } } },
      { kind: 'processing', toolName: 'dataset_id_map_provider', result: { counts: { mappedRecords: 2 } } },
      { kind: 'processing', toolName: 'dataset_join', result: { counts: { unmatchedLeftRecords: 1 } } },
      { kind: 'processing', toolName: 'dataset_graph_organize', result: { counts: { nodeRecords: 7, edgeRecords: 8 } } },
      { kind: 'profile', toolName: 'dataset_structure_profile', result: { profile: { coordinateRecords: 2500 } } },
      { kind: 'validation', toolName: 'dataset_structure_validate', result: { validation: { valid: true } } },
      { kind: 'validation', result: { validation: { valid: true } } },
      { kind: 'publication', result: { publication: { artifactCount: 2 }, quality: { status: 'passed' } } }
    ])
  })
})
