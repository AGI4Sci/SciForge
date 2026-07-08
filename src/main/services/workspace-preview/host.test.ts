import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPdfAnnotationSidecar } from '../pdf-annotation-sidecar-service'
import { WorkspacePreviewHost } from './host'
import type { WorkspacePreviewWorkerClient } from './worker-client'

describe('WorkspacePreviewHost', () => {
  let rootDir = ''
  let workspaceRoot = ''

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'workspace-preview-host-'))
    workspaceRoot = join(rootDir, 'workspace')
    await mkdir(workspaceRoot)
  })

  it('opens a safe workspace file without reading its content', async () => {
    const filePath = join(workspaceRoot, 'huge.csv')
    await writeFile(filePath, `a,b\n${'1,2\n'.repeat(1000)}`, 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-1' })

    const result = await host.open({
      workspaceRoot,
      path: 'huge.csv',
      mimeType: 'text/csv',
      now: '2026-07-08T00:00:00.000Z'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.session).toMatchObject({
      id: 'session-1',
      pluginId: 'tabular',
      modality: 'tabular',
      mode: 'preview'
    })
    expect(result.file.relativePath).toBe('huge.csv')
    expect(result.file.size).toBeGreaterThan(0)

    const observation = await host.observe(result.session.id)
    expect(observation).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'tabular', modality: 'tabular' },
        visibleText: expect.stringContaining('Tabular preview'),
        tables: [{ id: 'table-1', name: 'huge.csv', rowCount: 1000, columnCount: 2 }],
        actions: expect.arrayContaining(['observe', 'select', 'applyEdit', 'save', 'export'])
      }
    })
  })

  it('rejects paths outside the selected workspace', async () => {
    await writeFile(join(rootDir, 'outside.txt'), 'outside', 'utf8')
    const host = new WorkspacePreviewHost()

    const result = await host.open({
      workspaceRoot,
      path: '../outside.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('within the selected workspace')
  })

  it('rejects symlinked targets that leave the selected workspace', async () => {
    const outsidePath = join(rootDir, 'outside.txt')
    await writeFile(outsidePath, 'outside', 'utf8')
    await symlink(outsidePath, join(workspaceRoot, 'linked.txt'))
    const host = new WorkspacePreviewHost()

    const result = await host.open({
      workspaceRoot,
      path: 'linked.txt'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('within the selected workspace')
  })

  it('does not create observations for missing sessions', async () => {
    const host = new WorkspacePreviewHost()

    await expect(host.observe('missing')).resolves.toEqual({
      ok: false,
      message: 'Workspace preview session was not found.'
    })
  })

  it('reads bounded byte ranges from an opened session without eager-loading the file', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nATOM\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-range' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.readRange(opened.session.id, { offset: 7, length: 4 })

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'session-range',
      offset: 7,
      length: 4
    })
    if (result.ok) {
      expect(Buffer.from(result.dataBase64, 'base64').toString('utf8')).toBe('ATOM')
    }
  })

  it('describes lazy large-asset transport for life-science plugins', async () => {
    await writeFile(join(workspaceRoot, 'cells.ome.tiff'), Buffer.alloc(8 * 1024 * 1024))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-asset' })
    const opened = await host.open({
      workspaceRoot,
      path: 'cells.ome.tiff',
      mimeType: 'image/tiff'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.describeAsset(opened.session.id)

    expect(result).toMatchObject({
      ok: true,
      descriptor: {
        sessionId: 'session-asset',
        pluginId: 'bioimaging',
        modality: 'bioimaging',
        primary: 'byte-range',
        eagerRead: {
          allowed: false
        },
        range: {
          available: true,
          maxChunkBytes: 4 * 1024 * 1024,
          recommendedChunkBytes: 1024 * 1024,
          size: 8 * 1024 * 1024
        },
        strategies: expect.arrayContaining([
          expect.objectContaining({ kind: 'byte-range', status: 'available' }),
          expect.objectContaining({ kind: 'object-url', status: 'requires-renderer' }),
          expect.objectContaining({ kind: 'tile', status: 'requires-plugin' }),
          expect.objectContaining({ kind: 'thumbnail', status: 'requires-plugin' }),
          expect.objectContaining({ kind: 'cache-artifact', status: 'deferred' })
        ])
      }
    })
  })

  it('keeps generic fallback observations aligned with read-only life-science capabilities', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const workerClient = {
      observe: vi.fn(async () => ({
        ok: false,
        reason: 'worker-error',
        message: 'forced worker fallback'
      })),
      invokeAction: vi.fn()
    } as unknown as WorkspacePreviewWorkerClient
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-life-science-fallback',
      workerClient
    })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'molecular', modality: 'molecular' },
        actions: expect.arrayContaining(['observe', 'select', 'export'])
      }
    })
    if (observed.ok) {
      expect(observed.observation.actions).not.toContain('applyEdit')
      expect(observed.observation.actions).not.toContain('save')
    }
  })

  it('rejects oversized range reads before touching the file', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-range' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.readRange(opened.session.id, {
      offset: 0,
      length: 4 * 1024 * 1024 + 1
    })

    expect(result.ok).toBe(false)
  })

  it('reports deferred non-life-science scientific formats explicitly', async () => {
    await writeFile(join(workspaceRoot, 'mesh.vtk'), '# vtk data', 'utf8')
    const host = new WorkspacePreviewHost()

    const result = await host.open({
      workspaceRoot,
      path: 'mesh.vtk'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('deferred')
  })

  it('applies text range edits through the generic host with an audit trail', async () => {
    await writeFile(join(workspaceRoot, 'notes.md'), 'hello\nworld\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'notes.md',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'text.replaceRange',
      path: 'notes.md',
      range: {
        start: { line: 2, column: 1 },
        end: { line: 2, column: 6 }
      },
      text: 'SciForge'
    }, '2026-07-08T00:01:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'text.replaceRange',
      audit: {
        pluginId: 'legacy-markdown',
        effect: 'file-write'
      },
      diffSummary: {
        kind: 'bounded',
        operationKind: 'text.replaceRange',
        counts: {
          filesChanged: 1,
          charsInserted: 8,
          charsDeleted: 5
        },
        undo: {
          available: false
        }
      }
    })
    if (result.ok) {
      expect(result.diffSummary?.summary).toContain('Replaced text range')
      expect(result.diffSummary?.previews?.[0]).toMatchObject({
        before: 'world',
        after: 'SciForge'
      })
    }
    await expect(readFile(join(workspaceRoot, 'notes.md'), 'utf8')).resolves.toBe('hello\nSciForge\n')
  })

  it('observes first-party text previews with bounded visible text and edit actions', async () => {
    await writeFile(join(workspaceRoot, 'notes.txt'), 'alpha\nbeta\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-text' })
    const opened = await host.open({
      workspaceRoot,
      path: 'notes.txt',
      now: '2026-07-08T00:00:00.000Z'
    })

    expect(opened).toMatchObject({
      ok: true,
      manifest: {
        id: 'text',
        modality: 'text'
      }
    })
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: {
          pluginId: 'text',
          modality: 'text'
        },
        visibleText: 'alpha\nbeta\n',
        text: {
          lineCount: 3,
          characterCount: 11,
          truncated: false
        },
        actions: expect.arrayContaining(['workspace.setSelection', 'text.replaceRange', 'applyEdit'])
      }
    })
  })

  it('applies DOCX paragraph edits through the document edit operation', async () => {
    await writeFile(join(workspaceRoot, 'report.docx'), await createMinimalDocxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-docx-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'report.docx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'document.updateParagraph',
      path: 'report.docx',
      paragraphIndex: 2,
      text: 'Updated paragraph\nwith line break'
    }, '2026-07-08T00:02:30.000Z')
    const zip = await JSZip.loadAsync(await readFile(join(workspaceRoot, 'report.docx')))
    const documentXml = await zip.file('word/document.xml')?.async('string')

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'document.updateParagraph',
      audit: {
        pluginId: 'legacy-docx',
        effect: 'file-write'
      },
      diffSummary: {
        summary: 'Updated DOCX paragraph 2.',
        operationKind: 'document.updateParagraph',
        counts: {
          filesChanged: 1,
          charsInserted: 33,
          charsDeleted: 24
        },
        previews: [{
          before: 'First paragraph\twith tab',
          after: 'Updated paragraph\nwith line break'
        }]
      }
    })
    expect(documentXml).toContain('Updated paragraph')
    expect(documentXml).toContain('<w:br/>')
    expect(documentXml).toContain('with line break')
  })

  it('upserts PDF annotations through the generic host sidecar path', async () => {
    const sourcePdf = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n'
    await writeFile(join(workspaceRoot, 'paper.pdf'), sourcePdf, 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-pdf-annotation' })
    const opened = await host.open({
      workspaceRoot,
      path: 'paper.pdf',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const created = await host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'ann-1',
      annotationKind: 'comment',
      body: 'Check the stated assay result.',
      target: {
        documentKind: 'pdf',
        threadId: 'thread-1',
        anchor: {
          id: 'anchor-1',
          kind: 'text',
          quote: 'assay result',
          rects: [{ page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.05 }]
        },
        thread: {
          status: 'open',
          title: 'Assay result'
        },
        annotation: {
          color: '#facc15',
          sourceText: 'assay result'
        }
      }
    }, '2026-07-08T00:03:00.000Z')
    const updated = await host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'paper.pdf',
      annotationId: 'ann-1',
      annotationKind: 'note',
      body: 'Updated assay note.'
    }, '2026-07-08T00:04:00.000Z')
    const loaded = await loadPdfAnnotationSidecar({
      pdfPath: 'paper.pdf',
      workspaceRoot
    })
    const observed = await host.observe(opened.session.id)

    expect(created).toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert',
      audit: {
        pluginId: 'legacy-pdf',
        effect: 'sidecar-write'
      },
      diffSummary: {
        summary: 'Created comment annotation ann-1.',
        counts: {
          filesChanged: 1,
          charsInserted: 30,
          charsDeleted: 0
        }
      }
    })
    expect(updated).toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert',
      audit: {
        effect: 'sidecar-write'
      },
      diffSummary: {
        summary: 'Updated note annotation ann-1.',
        counts: {
          filesChanged: 1,
          charsInserted: 19,
          charsDeleted: 30
        },
        previews: [{
          before: 'Check the stated assay result.',
          after: 'Updated assay note.'
        }]
      }
    })
    await expect(readFile(join(workspaceRoot, 'paper.pdf'), 'utf8')).resolves.toBe(sourcePdf)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.anchors).toHaveLength(1)
    expect(loaded.sidecar.anchors[0]).toMatchObject({
      id: 'anchor-1',
      kind: 'text',
      pageStart: 1,
      pageEnd: 1,
      quote: 'assay result'
    })
    expect(loaded.sidecar.annotations).toHaveLength(1)
    expect(loaded.sidecar.annotations[0]).toMatchObject({
      id: 'ann-1',
      threadId: 'thread-1',
      anchorId: 'anchor-1',
      kind: 'note',
      body: 'Updated assay note.',
      color: '#facc15',
      sourceText: 'assay result'
    })
    expect(loaded.sidecar.threads).toHaveLength(1)
    expect(loaded.sidecar.threads[0]).toMatchObject({
      id: 'thread-1',
      anchorIds: ['anchor-1'],
      annotationIds: ['ann-1'],
      title: 'Assay result'
    })
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        annotations: [{
          id: 'thread-1',
          kind: 'comment',
          summary: 'open | page 1 | Assay result | Updated assay note.'
        }],
        actions: expect.arrayContaining(['annotation.upsert'])
      }
    })
    if (observed.ok) {
      const annotationPayload = JSON.stringify(observed.observation.annotations)
      expect(annotationPayload).not.toContain('rects')
      expect(annotationPayload).not.toContain('sha256')
      expect(annotationPayload).not.toContain('sourceMessageId')
    }
  })

  it('upserts DOCX annotations with text anchors and no PDF rects', async () => {
    await writeFile(join(workspaceRoot, 'report.docx'), await createMinimalDocxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-docx-annotation' })
    const opened = await host.open({
      workspaceRoot,
      path: 'report.docx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'annotation.upsert',
      path: 'report.docx',
      annotationId: 'docx-ann-1',
      annotationKind: 'question',
      body: 'Clarify this paragraph.',
      target: {
        documentKind: 'docx',
        threadId: 'docx-thread-1',
        anchor: {
          id: 'docx-anchor-1',
          kind: 'text',
          quote: 'First paragraph with tab',
          contextBefore: 'Intro',
          contextAfter: 'Next paragraph'
        },
        thread: {
          title: 'Paragraph question'
        }
      }
    }, '2026-07-08T00:03:30.000Z')
    const loaded = await loadPdfAnnotationSidecar({
      pdfPath: 'report.docx',
      workspaceRoot
    })
    const observed = await host.observe(opened.session.id)

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'annotation.upsert',
      audit: {
        pluginId: 'legacy-docx',
        effect: 'sidecar-write'
      }
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.sidecar.anchors).toHaveLength(1)
    expect(loaded.sidecar.anchors[0]).toMatchObject({
      id: 'docx-anchor-1',
      kind: 'text',
      rects: [],
      quote: 'First paragraph with tab',
      contextBefore: 'Intro',
      contextAfter: 'Next paragraph'
    })
    expect(loaded.sidecar.annotations).toEqual([
      expect.objectContaining({
        id: 'docx-ann-1',
        threadId: 'docx-thread-1',
        anchorId: 'docx-anchor-1',
        kind: 'question',
        body: 'Clarify this paragraph.',
        sourceText: 'First paragraph with tab'
      })
    ])
    expect(loaded.sidecar.threads).toEqual([
      expect.objectContaining({
        id: 'docx-thread-1',
        kind: 'question',
        anchorIds: ['docx-anchor-1'],
        annotationIds: ['docx-ann-1'],
        title: 'Paragraph question'
      })
    ])
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        annotations: [{
          id: 'docx-thread-1',
          kind: 'question',
          summary: 'open | page 1 | Paragraph question | Clarify this paragraph.'
        }],
        actions: expect.arrayContaining(['annotation.upsert'])
      }
    })
  })

  it('applies CSV cell edits through the tabular plugin with safe write-back', async () => {
    await writeFile(join(workspaceRoot, 'samples.csv'), 'sample,count,note\ns1,2,old\ns2,3,ok\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-csv-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'samples.csv',
      mimeType: 'text/csv',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.updateCell',
      path: 'samples.csv',
      row: 0,
      column: 2,
      value: 'alpha, "quoted"'
    }, '2026-07-08T00:02:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'tabular.updateCell',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        summary: 'Updated cell R0C2.',
        counts: {
          filesChanged: 1,
          cellsChanged: 1
        },
        target: {
          tabular: {
            cells: [{ row: 0, column: 2 }]
          }
        },
        undo: {
          available: false
        }
      }
    })
    await expect(readFile(join(workspaceRoot, 'samples.csv'), 'utf8'))
      .resolves.toBe('sample,count,note\ns1,2,"alpha, ""quoted"""\ns2,3,ok\n')
  })

  it('applies TSV row inserts relative to data rows through the tabular plugin', async () => {
    await writeFile(join(workspaceRoot, 'samples.tsv'), 'sample\tcount\ns1\t2\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-tsv-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'samples.tsv',
      mimeType: 'text/tab-separated-values'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.insertRows',
      path: 'samples.tsv',
      afterRow: -1,
      rows: [['s0', 1]]
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'tabular.insertRows',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      }
    })
    await expect(readFile(join(workspaceRoot, 'samples.tsv'), 'utf8'))
      .resolves.toBe('sample\tcount\ns0\t1\ns1\t2\n')
  })

  it('applies CSV column inserts across headers and data rows through the tabular plugin', async () => {
    await writeFile(join(workspaceRoot, 'insert-columns.csv'), 'sample,count\ns1,2\ns2\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-csv-column-insert' })
    const opened = await host.open({
      workspaceRoot,
      path: 'insert-columns.csv',
      mimeType: 'text/csv'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.insertColumns',
      path: 'insert-columns.csv',
      afterColumn: -1,
      columns: [
        ['group', 'control, A'],
        ['note', '"quoted"']
      ]
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'tabular.insertColumns',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          columnsInserted: 2
        },
        target: {
          tabular: {
            columns: [0, 1]
          }
        },
        undo: {
          available: false
        }
      }
    })
    await expect(readFile(join(workspaceRoot, 'insert-columns.csv'), 'utf8'))
      .resolves.toBe('group,note,sample,count\n"control, A","""quoted""",s1,2\n,,s2,\n')
  })

  it('applies CSV row and column deletes through the tabular plugin with header-aware write-back', async () => {
    await writeFile(join(workspaceRoot, 'delete-me.csv'), 'sample,count,note\ns1,2,old\ns2,3,ok\ns3,4,done\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-csv-delete' })
    const opened = await host.open({
      workspaceRoot,
      path: 'delete-me.csv',
      mimeType: 'text/csv'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const rowResult = await host.applyEdit(opened.session.id, {
      kind: 'tabular.deleteRows',
      path: 'delete-me.csv',
      rows: [1]
    })
    const columnResult = await host.applyEdit(opened.session.id, {
      kind: 'tabular.deleteColumns',
      path: 'delete-me.csv',
      columns: [1]
    })

    expect(rowResult).toMatchObject({
      ok: true,
      operationKind: 'tabular.deleteRows',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          rowsDeleted: 1
        },
        target: {
          tabular: {
            rows: [1]
          }
        }
      }
    })
    expect(columnResult).toMatchObject({
      ok: true,
      operationKind: 'tabular.deleteColumns',
      audit: {
        pluginId: 'tabular',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          columnsDeleted: 1
        },
        target: {
          tabular: {
            columns: [1]
          }
        }
      }
    })
    await expect(readFile(join(workspaceRoot, 'delete-me.csv'), 'utf8'))
      .resolves.toBe('sample,note\ns1,old\ns3,done\n')
  })

  it('rejects tabular write-back for formats without a safe delimited serializer', async () => {
    await writeFile(join(workspaceRoot, 'records.jsonl'), '{"sample":"s1","count":2}\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-jsonl-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'records.jsonl',
      mimeType: 'application/x-ndjson'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)
    expect(observed.ok).toBe(true)
    if (observed.ok) {
      expect(observed.observation.actions).toContain('tabular.filterRows')
      expect(observed.observation.actions).not.toContain('applyEdit')
      expect(observed.observation.actions).not.toContain('save')
      expect(observed.observation.actions).not.toContain('tabular.updateCell')
      expect(observed.observation.actions).not.toContain('tabular.insertColumns')
    }

    const result = await host.applyEdit(opened.session.id, {
      kind: 'tabular.updateCell',
      path: 'records.jsonl',
      row: 0,
      column: 1,
      value: 3
    })
    const insertResult = await host.applyEdit(opened.session.id, {
      kind: 'tabular.insertColumns',
      path: 'records.jsonl',
      afterColumn: -1,
      columns: [['group', 'control']]
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('CSV and TSV')
    expect(insertResult.ok).toBe(false)
    if (!insertResult.ok) expect(insertResult.message).toContain('CSV and TSV')
    await expect(readFile(join(workspaceRoot, 'records.jsonl'), 'utf8'))
      .resolves.toBe('{"sample":"s1","count":2}\n')
  })

  it('updates session selection for molecular selection edits', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-mol' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'molecular.setSelection',
      path: 'protein.pdb',
      selection: {
        kind: 'molecular',
        chains: ['A'],
        residues: [{ chain: 'A', index: 42, name: 'TYR' }]
      }
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'molecular.setSelection',
      audit: { effect: 'session-update' }
    })
    expect(host.getSession(opened.session.id)?.selection).toMatchObject({
      kind: 'molecular',
      chains: ['A']
    })
    await expect(host.observe(opened.session.id)).resolves.toMatchObject({
      ok: true,
      observation: {
        selection: {
          kind: 'molecular',
          chains: ['A']
        }
      }
    })
  })

  it('updates and observes generic structured selections for life-science plugins', async () => {
    await writeFile(join(workspaceRoot, 'variants.vcf'), '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t42\t.\tA\tG\t.\tPASS\t.\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-sequence' })
    const opened = await host.open({
      workspaceRoot,
      path: 'variants.vcf'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'workspace.setSelection',
      path: 'variants.vcf',
      selection: {
        kind: 'sequence',
        sequenceId: 'chr1',
        ranges: [{ start: 42, end: 43 }],
        features: [{ type: 'variant', start: 42, end: 43 }]
      }
    })

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'workspace.setSelection',
      audit: { effect: 'session-update' }
    })
    await expect(host.observe(opened.session.id)).resolves.toMatchObject({
      ok: true,
      observation: {
        selection: {
          kind: 'sequence',
          sequenceId: 'chr1'
        }
      }
    })
  })

  it('overlays session selection onto worker observations at the host boundary', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const workerClient = {
      observe: vi.fn<WorkspacePreviewWorkerClient['observe']>(async ({ session, manifest, file }) => ({
        ok: true,
        observation: {
          schemaVersion: 1,
          file: {
            path: file.path,
            workspaceRoot: file.workspaceRoot,
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
            ...(file.size !== undefined ? { size: file.size } : {}),
            ...(file.mtimeMs !== undefined ? { mtimeMs: file.mtimeMs } : {})
          },
          view: {
            pluginId: manifest.id,
            modality: manifest.modality,
            mode: session.mode,
            title: 'protein.pdb'
          },
          molecular: {
            chains: ['B']
          },
          actions: ['molecular.select']
        },
        bytesRead: 0,
        truncated: false
      })),
      invokeAction: vi.fn<WorkspacePreviewWorkerClient['invokeAction']>()
    } as Pick<WorkspacePreviewWorkerClient, 'observe' | 'invokeAction'>
    const host = new WorkspacePreviewHost({
      createSessionId: () => 'session-molecular-overlay',
      workerClient: workerClient as WorkspacePreviewWorkerClient
    })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const selection = {
      kind: 'molecular' as const,
      chains: ['A']
    }
    const applied = await host.applyEdit(opened.session.id, {
      kind: 'workspace.setSelection',
      path: 'protein.pdb',
      selection
    })
    expect(applied.ok).toBe(true)

    const observed = await host.observe(opened.session.id)

    expect(workerClient.observe).toHaveBeenCalledTimes(1)
    expect(observed).toMatchObject({
      ok: true,
      observation: {
        molecular: {
          chains: ['B']
        },
        selection
      }
    })
  })

  it('invokes bounded worker actions with audit metadata', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), [
      'ATOM      1  N   MET A   1      11.104  13.207   9.447  1.00 20.00           N',
      'ATOM      2  CA  MET A   1      12.560  13.401   9.447  1.00 20.00           C',
      'END'
    ].join('\n'), 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-action' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.invokeAction(opened.session.id, {
      actionId: 'molecular.select',
      input: {
        chains: ['A']
      }
    }, '2026-07-08T00:02:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'session-action',
      pluginId: 'molecular',
      actionId: 'molecular.select',
      invokedAt: '2026-07-08T00:02:00.000Z',
      result: {
        ok: true,
        atomCount: 2,
        selection: {
          kind: 'molecular',
          chains: ['A']
        }
      },
      audit: {
        pluginId: 'molecular',
        actionId: 'molecular.select',
        effect: 'worker-action'
      }
    })

    const distanceResult = await host.invokeAction(opened.session.id, {
      actionId: 'molecular.measureDistance',
      input: {
        atoms: [{ id: '1' }, { index: 2 }]
      }
    }, '2026-07-08T00:03:00.000Z')

    expect(distanceResult).toMatchObject({
      ok: true,
      sessionId: 'session-action',
      pluginId: 'molecular',
      actionId: 'molecular.measureDistance',
      invokedAt: '2026-07-08T00:03:00.000Z',
      result: {
        ok: true,
        coordinateAvailable: true,
        unit: 'angstrom',
        selection: {
          kind: 'molecular',
          atoms: [{ id: '1', index: 1 }, { id: '2', index: 2 }]
        }
      },
      audit: {
        pluginId: 'molecular',
        actionId: 'molecular.measureDistance',
        effect: 'worker-action'
      }
    })
    expect((distanceResult as { result?: { distance?: number } }).result?.distance)
      .toBeCloseTo(1.4689, 3)
  })

  it('observes sequence files through first-party worker summaries', async () => {
    await writeFile(join(workspaceRoot, 'reads.fasta'), '>seq1\nACGT\n>seq2\nACGA\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-seq' })
    const opened = await host.open({
      workspaceRoot,
      path: 'reads.fasta'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'sequence-genomics', modality: 'sequence' },
        sequence: {
          sequenceCount: 2,
          totalLength: 8,
          alphabet: 'dna'
        },
        visibleText: expect.stringContaining('Sequences or references: 2')
      }
    })
  })

  it('falls back to generic observation when a worker cannot safely summarize a format', async () => {
    await writeFile(join(workspaceRoot, 'large.pptx'), Buffer.alloc(4 * 1024 * 1024 + 8))
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-deck' })
    const opened = await host.open({
      workspaceRoot,
      path: 'large.pptx'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)

    expect(observed).toMatchObject({
      ok: true,
      observation: {
        view: { pluginId: 'deck', modality: 'deck' },
        actions: expect.arrayContaining(['observe', 'select', 'applyEdit', 'save', 'export'])
      }
    })
    if (observed.ok) {
      expect(observed.observation.slides).toBeUndefined()
    }
  })

  it('applies PPTX deck text element edits and re-observes the updated file', async () => {
    await writeFile(join(workspaceRoot, 'talk.pptx'), await createMinimalPptxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-deck-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'talk.pptx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const observed = await host.observe(opened.session.id)
    expect(observed.ok).toBe(true)
    if (!observed.ok) return
    const target = observed.observation.deck?.textElements?.find((element) =>
      element.slideId === 'slide1' &&
      element.kind === 'body' &&
      element.text === 'Assay response increased after treatment.'
    )
    expect(target).toBeTruthy()
    if (!target) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'deck.updateTextElement',
      path: 'talk.pptx',
      slideId: target.slideId,
      elementId: target.elementId,
      text: 'Assay response remained stable after washout.'
    }, '2026-07-08T00:04:00.000Z')
    const nextObserved = await host.observe(opened.session.id)

    expect(result).toMatchObject({
      ok: true,
      operationKind: 'deck.updateTextElement',
      audit: {
        pluginId: 'deck',
        effect: 'file-write'
      },
      diffSummary: {
        counts: {
          filesChanged: 1,
          charsInserted: 45,
          charsDeleted: 41
        },
        previews: [{
          before: 'Assay response increased after treatment.',
          after: 'Assay response remained stable after washout.'
        }]
      }
    })
    expect(nextObserved).toMatchObject({
      ok: true,
      observation: {
        deck: {
          textElements: expect.arrayContaining([
            expect.objectContaining({
              slideId: target.slideId,
              elementId: target.elementId,
              text: 'Assay response remained stable after washout.'
            })
          ])
        }
      }
    })
  })

  it('exports PPTX deck source copies and rejects renderer-only deck conversions', async () => {
    await writeFile(join(workspaceRoot, 'talk.pptx'), await createMinimalPptxBytes())
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-deck-export' })
    const opened = await host.open({
      workspaceRoot,
      path: 'talk.pptx',
      now: '2026-07-08T00:00:00.000Z'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const pptxCopy = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pptx'
    }, '2026-07-08T00:05:00.000Z')
    const pdfConversion = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdf',
      path: 'talk.pdf'
    }, '2026-07-08T00:06:00.000Z')

    expect(pptxCopy).toMatchObject({
      ok: true,
      sessionId: 'session-deck-export',
      audit: {
        pluginId: 'deck',
        targetKind: 'workspace-file',
        format: 'pptx',
        effect: 'source-copy'
      }
    })
    if (pptxCopy.ok) {
      expect(pptxCopy.path.endsWith('/talk.export.pptx')).toBe(true)
      const copiedObservation = await host.open({
        workspaceRoot,
        path: 'talk.export.pptx'
      })
      expect(copiedObservation.ok).toBe(true)
    }
    expect(pdfConversion.ok).toBe(false)
    if (!pdfConversion.ok) expect(pdfConversion.message).toContain('does not declare pdf export support')
  })

  it('exports declared source formats to a workspace file with an audit trail', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-export' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdb',
      path: 'exports/protein-copy.pdb'
    }, '2026-07-08T00:02:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      sessionId: 'session-export',
      audit: {
        pluginId: 'molecular',
        targetKind: 'workspace-file',
        format: 'pdb',
        effect: 'source-copy'
      }
    })
    await expect(readFile(join(workspaceRoot, 'exports/protein-copy.pdb'), 'utf8')).resolves.toBe('HEADER\nEND\n')

    const defaultResult = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdb'
    }, '2026-07-08T00:03:00.000Z')
    const conflictResult = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'pdb'
    }, '2026-07-08T00:04:00.000Z')

    expect(defaultResult).toMatchObject({
      ok: true,
      target: {
        kind: 'workspace-file',
        format: 'pdb'
      }
    })
    expect(conflictResult).toMatchObject({
      ok: true
    })
    if (defaultResult.ok) {
      expect(defaultResult.path.endsWith('/protein.export.pdb')).toBe(true)
      await expect(readFile(defaultResult.path, 'utf8')).resolves.toBe('HEADER\nEND\n')
    }
    if (conflictResult.ok) {
      expect(conflictResult.path.endsWith('/protein.export-2.pdb')).toBe(true)
      await expect(readFile(conflictResult.path, 'utf8')).resolves.toBe('HEADER\nEND\n')
    }
  })

  it('rejects undeclared export formats and renderer-only export targets', async () => {
    await writeFile(join(workspaceRoot, 'protein.pdb'), 'HEADER\nEND\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-export' })
    const opened = await host.open({
      workspaceRoot,
      path: 'protein.pdb'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const unsupportedFormat = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'xlsx',
      path: 'exports/protein.xlsx'
    })
    const clipboardTarget = await host.exportPreview(opened.session.id, {
      kind: 'clipboard',
      format: 'pdb'
    })
    const conversionTarget = await host.exportPreview(opened.session.id, {
      kind: 'workspace-file',
      format: 'cif',
      path: 'exports/protein.cif'
    })

    expect(unsupportedFormat.ok).toBe(false)
    if (!unsupportedFormat.ok) expect(unsupportedFormat.message).toContain('does not declare')
    expect(clipboardTarget.ok).toBe(false)
    if (!clipboardTarget.ok) expect(clipboardTarget.message).toContain('requires a renderer/plugin implementation')
    expect(conversionTarget.ok).toBe(false)
    if (!conversionTarget.ok) expect(conversionTarget.message).toContain('requires a plugin implementation')
  })

  it('prepares preview file watches from safe file state without eager content payloads', async () => {
    await writeFile(join(workspaceRoot, 'samples.csv'), 'sample,count\ns1,2\n', 'utf8')
    const host = new WorkspacePreviewHost()

    const result = await host.prepareWatch({
      workspaceRoot,
      path: 'samples.csv'
    }, '2026-07-08T00:03:00.000Z')

    expect(result).toMatchObject({
      ok: true,
      content: '',
      size: 18,
      truncated: false,
      startedAt: '2026-07-08T00:03:00.000Z'
    })
    if (result.ok) {
      expect(result.path.endsWith('samples.csv')).toBe(true)
      expect(result.workspaceRoot.endsWith('workspace')).toBe(true)
      expect(result.mtimeMs).toBeGreaterThan(0)
    }
  })

  it('rejects edit operations for a different file than the open session', async () => {
    await writeFile(join(workspaceRoot, 'a.md'), 'a\n', 'utf8')
    await writeFile(join(workspaceRoot, 'b.md'), 'b\n', 'utf8')
    const host = new WorkspacePreviewHost({ createSessionId: () => 'session-edit' })
    const opened = await host.open({
      workspaceRoot,
      path: 'a.md'
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const result = await host.applyEdit(opened.session.id, {
      kind: 'text.replaceRange',
      path: 'b.md',
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 }
      },
      text: 'edited'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('must match')
  })
})

async function createMinimalDocxBytes(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>'
  ].join(''))
  zip.file('_rels/.rels', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>'
  ].join(''))
  zip.file('word/document.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Study note</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>First paragraph</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>with tab</w:t></w:r></w:p>',
    '</w:body>',
    '</w:document>'
  ].join(''))
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function createMinimalPptxBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`)
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="257" r:id="rId2"/>
    <p:sldId id="256" r:id="rId1"/>
  </p:sldIdLst>
</p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`)
  zip.file('ppt/slides/slide1.xml', slideXml('Results', 'Assay response increased after treatment.'))
  zip.file('ppt/slides/slide2.xml', slideXml('Methods', 'Cells were profiled with a compact panel.'))
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`)
  zip.file('ppt/notesSlides/notesSlide1.xml', notesXml('Mention replicated wells and follow-up validation.'))
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

function slideXml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="1" name="Title"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Content"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
}

function notesXml(notes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Notes"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${notes}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`
}
