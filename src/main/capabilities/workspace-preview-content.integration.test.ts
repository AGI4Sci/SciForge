import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capabilityResourceHandleSchema } from '../../shared/capability-broker'
import { WorkspacePreviewHost } from '../services/workspace-preview'
import { ControlledProcessService } from '../processes/controlled-process-service'
import { VersionControlWorkspaceService } from '../services/version-control-workspace-service'
import { APP_CAPABILITY_IDS, WORKSPACE_PREVIEW_RESOURCE_KIND } from './app-registry'
import { CapabilityBroker } from './broker'
import {
  createApplicationCapabilityRegistry,
  createApplicationDomainCatalog
} from '../modules'
import { createNonSecretPackageStorageForTest } from '../modules/domain-package-storage.test-helper'
import { createUnavailablePortableResourcesForTest } from '../modules/domain-main-host.test-helper'

function outputRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy()
  expect(typeof value).toBe('object')
  expect(Array.isArray(value)).toBe(false)
  return value as Record<string, unknown>
}

describe('Workspace Preview capability content transport integration', () => {
  it('opens, observes, describes, and range-reads a real PDF asset through the broker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-preview-content-'))
    const workspaceRoot = join(root, 'workspace')
    const fileName = 'paper.pdf'
    const filePath = join(workspaceRoot, fileName)
    const fileBytes = Buffer.concat([
      Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstream\n', 'utf8'),
      Buffer.from([0x00, 0xff, 0x10, 0x80, 0x41, 0x42, 0x43, 0x7f]),
      Buffer.from('\nendstream\n%%EOF\n', 'utf8')
    ])

    try {
      await mkdir(workspaceRoot)
      await writeFile(filePath, fileBytes)
      const canonicalFilePath = await realpath(filePath)

      const workspacePreviewHost = new WorkspacePreviewHost({
        createSessionId: () => 'integration-pdf-session'
      })
      const catalog = createApplicationDomainCatalog({
        getUserDataDir: () => root,
        getDeviceId: () => 'device-workspace-preview-content-test',
        portableResourcesFor: createUnavailablePortableResourcesForTest(),
        packageStorageFor: createNonSecretPackageStorageForTest(),
        capabilityInvokerFor: () => ({
          invoke: async () => { throw new Error('Domain system capabilities are unavailable in this test.') },
          createApprovedBatch: () => { throw new Error('Domain system capabilities are unavailable in this test.') }
        })
      })
      const broker = new CapabilityBroker(createApplicationCapabilityRegistry(catalog, {
        controlledProcessService: new ControlledProcessService(),
        workspacePreviewHost,
        versionControlWorkspaceService: new VersionControlWorkspaceService()
      }))
      const caller = {
        audience: 'ui' as const,
        callerId: 'integration-window',
        workspaceId: workspaceRoot
      }

      const opened = await broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.workspacePreviewOpen,
        input: {
          path: fileName,
          workspaceRoot,
          mimeType: 'application/pdf'
        }
      })
      const handle = capabilityResourceHandleSchema.parse(outputRecord(opened.output).resource)

      const observed = await broker.observe(caller, { resource: handle })
      expect(observed).toMatchObject({
        resourceKind: WORKSPACE_PREVIEW_RESOURCE_KIND,
        state: {
          session: {
            id: 'integration-pdf-session',
            pluginId: 'pdf',
            path: canonicalFilePath
          },
          observation: {
            file: { path: canonicalFilePath, size: fileBytes.length },
            view: { pluginId: 'pdf', modality: 'document' }
          }
        }
      })

      const descriptor = await broker.describeResourceContent(caller, handle)
      expect(descriptor).toMatchObject({
        size: fileBytes.length,
        mimeType: 'application/pdf',
        fileName
      })

      const offset = 11
      const length = 19
      const contentRange = await broker.readResourceContentRange(caller, handle, { offset, length })
      expect(contentRange).toEqual({
        offset,
        length,
        size: fileBytes.length,
        dataBase64: fileBytes.subarray(offset, offset + length).toString('base64')
      })
      expect(offset).toBeGreaterThan(0)
      expect(Buffer.from(contentRange.dataBase64, 'base64')).toEqual(fileBytes.subarray(offset, offset + length))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it('reads an annotation range beyond the initial observation and edits exactly that source through the broker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-preview-edit-'))
    const workspaceRoot = root
    const filePath = join(root, 'report.md')
    const prefix = Array.from({ length: 300 }, (_, index) => `Background ${index}: ${'正文'.repeat(70)}\n`).join('')
    const original = `${prefix}## 图示\n![plot](figure.png)\n后续结论😀\n`
    const workspacePreviewHost = new WorkspacePreviewHost()
    try {
      await writeFile(filePath, original)
      const catalog = createApplicationDomainCatalog({
        getUserDataDir: () => root,
        getDeviceId: () => 'device-workspace-preview-content-test',
        portableResourcesFor: createUnavailablePortableResourcesForTest(),
        packageStorageFor: createNonSecretPackageStorageForTest(),
        capabilityInvokerFor: () => ({
          invoke: async () => { throw new Error('Domain system capabilities are unavailable in this test.') },
          createApprovedBatch: () => { throw new Error('Domain system capabilities are unavailable in this test.') }
        })
      })
      const broker = new CapabilityBroker(createApplicationCapabilityRegistry(catalog, {
        controlledProcessService: new ControlledProcessService(),
        workspacePreviewHost,
        versionControlWorkspaceService: new VersionControlWorkspaceService()
      }))
      const caller = { audience: 'agent' as const, callerId: 'dsh:integration', workspaceId: workspaceRoot }
      const opened = await broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.workspacePreviewOpen, input: { path: filePath, workspaceRoot }
      })
      const handle = capabilityResourceHandleSchema.parse(outputRecord(opened.output).resource)
      const initial = await broker.observe(caller, { resource: handle })
      await broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.workspacePreviewAnnotationsUpdate, resource: initial.resource,
        invocationId: 'fixture-annotation', expectedRevision: initial.semanticRevision,
        input: { annotationId: 'caption-note', annotationKind: 'comment', body: '这张图缺乏说明，需要写个 caption',
          target: { documentKind: 'markdown', threadId: 'caption-thread',
            anchor: { id: 'caption-anchor', kind: 'text', quote: '## 图示',
              textRange: { start: prefix.length, end: prefix.length + 5,
                startLine: 301, startColumn: 1, endLine: 301, endColumn: 6 } } } }
      })
      const observed = await broker.observe(caller, { resource: handle })
      const annotations = await broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.workspacePreviewAnnotationsList, resource: observed.resource, input: {}
      })
      expect(JSON.stringify(annotations.output)).toContain('这张图缺乏说明，需要写个 caption')
      expect(JSON.stringify(annotations.output)).toContain('"startLine":301')
      const read = await broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.workspacePreviewReadRange, resource: observed.resource,
        input: { range: { start: { line: 301, column: 1 }, maxCharacters: 1000 } }
      })
      const source = outputRecord(read.output)
      expect(source).toMatchObject({ ok: true, text: '## 图示\n![plot](figure.png)\n后续结论😀\n', truncated: false })
      expect(source).not.toHaveProperty('dataBase64')
      const caption = '图 1：说明图中变量、比较条件和结论。\n'
      const edited = await broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.workspacePreviewApplyEdit, resource: observed.resource,
        invocationId: 'caption-edit', expectedRevision: observed.semanticRevision,
        input: { operation: { kind: 'text.replaceRange', path: filePath,
          range: { start: { line: 303, column: 1 }, end: { line: 303, column: 1 } }, text: caption } }
      })
      expect(edited.changed).toBe(true)
      expect(await readFile(filePath, 'utf8')).toBe(`${prefix}## 图示\n![plot](figure.png)\n${caption}后续结论😀\n`)
      const refreshed = await broker.observe(caller, { resource: handle })
      const verified = await broker.invoke(caller, {
        actionId: APP_CAPABILITY_IDS.workspacePreviewReadRange, resource: refreshed.resource,
        input: { range: { start: { line: 303, column: 1 }, maxCharacters: 1000 } }
      })
      expect(outputRecord(verified.output).text).toBe(`${caption}后续结论😀\n`)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

})
