import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
        capabilityInvokerFor: () => ({
          invoke: async () => { throw new Error('Domain system capabilities are unavailable in this test.') }
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
})
