import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CodexWorkspacePatchTool } from './codex-workspace-patch-tool'

describe('CodexWorkspacePatchTool', () => {
  it('updates one existing file and rejects ambiguous, add, rename, and multi-file patches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-codex-patch-'))
    const outsideName = `${basename(root)}-outside.txt`
    const outsidePath = join(root, '..', outsideName)
    try {
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'one.txt'), 'unique\nold\nend\n', 'utf8')
      await writeFile(join(root, 'ambiguous.txt'), 'same\nold\nsame\nold\n', 'utf8')
      await writeFile(join(root, 'coincidental.txt'), 'replacement\nother\n', 'utf8')
      await writeFile(outsidePath, 'outside\n', 'utf8')
      const tool = new CodexWorkspacePatchTool()

      await expect(tool.apply({
        workspaceRoot: root,
        path: 'one.txt',
        patch: '--- a/one.txt\n+++ b/one.txt\n@@ -1,3 +1,3 @@\n unique\n-old\n+new\n end'
      })).resolves.toMatchObject({
        success: true,
        stateChanged: true,
        structuredContent: { ok: true, applied: true }
      })
      await expect(readFile(join(root, 'one.txt'), 'utf8')).resolves.toBe('unique\nnew\nend\n')

      await expect(tool.apply({
        workspaceRoot: root,
        path: 'one.txt',
        patch: '--- a/one.txt\n+++ b/one.txt\n@@ -1,3 +1,3 @@\n unique\n-old\n+new\n end'
      })).resolves.toMatchObject({
        success: true,
        stateChanged: false,
        contentItems: [expect.objectContaining({ text: expect.stringContaining('already applied') })],
        structuredContent: { ok: true, applied: false }
      })

      for (const input of [
        {
          path: 'ambiguous.txt',
          patch: '*** Begin Patch\n*** Update File: ambiguous.txt\n@@\n same\n-old\n+new\n*** End Patch',
          error: 'ambiguous',
          errorCode: 'patch_context_ambiguous',
          failureClass: 'invalid_arguments'
        },
        {
          path: 'one.txt',
          patch: '--- /dev/null\n+++ b/one.txt\n@@ -0,0 +1 @@\n+new',
          error: 'add/delete',
          errorCode: 'patch_add_delete_unsupported',
          failureClass: 'invalid_arguments'
        },
        {
          path: 'one.txt',
          patch: '--- a/one.txt\n+++ b/renamed.txt\n@@ -1 +1 @@\n-unique\n+changed',
          error: 'renaming',
          errorCode: 'patch_rename_unsupported',
          failureClass: 'invalid_arguments'
        },
        {
          path: 'one.txt',
          patch: '*** Begin Patch\n*** Update File: one.txt\n@@\n-new\n+again\n*** Update File: other.txt\n@@\n-a\n+b\n*** End Patch',
          error: 'one existing file',
          errorCode: 'patch_multiple_files',
          failureClass: 'invalid_arguments'
        },
        {
          path: 'one.txt',
          patch: '*** Begin Patch\n*** Update File: one.txt\n@@\n-missing context\n+replacement\n*** End Patch',
          error: 'context mismatch',
          errorCode: 'patch_context_mismatch',
          failureClass: 'stale_resource'
        },
        {
          path: 'coincidental.txt',
          patch: '*** Begin Patch\n*** Update File: coincidental.txt\n@@\n-missing context\n+replacement\n*** End Patch',
          error: 'context mismatch',
          errorCode: 'patch_context_mismatch',
          failureClass: 'stale_resource'
        },
        {
          path: `../${outsideName}`,
          patch: '@@\n-outside\n+escaped',
          error: 'inside the current workspace',
          errorCode: 'patch_path_outside_workspace',
          failureClass: 'permission_denied'
        }
      ]) {
        const result = await tool.apply({ workspaceRoot: root, path: input.path, patch: input.patch })
        expect(result).toMatchObject({
          success: false,
          contentItems: [expect.objectContaining({ text: expect.stringContaining(input.error) })],
          errorCode: input.errorCode,
          failureClass: input.failureClass,
          stateChanged: false,
          structuredContent: {
            ok: false,
            error: {
              code: input.errorCode,
              failureClass: input.failureClass
            }
          }
        })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outsidePath, { force: true })
    }
  })
})
