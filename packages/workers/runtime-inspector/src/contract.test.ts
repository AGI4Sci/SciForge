import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GitDiffPreviewInputSchema,
  LspQueryInputSchema,
  RuntimeInspectorToolNames,
  gitDiffResourceUri
} from './contract.js'

test('validates Git diff preview tool schema', () => {
  assert.equal(GitDiffPreviewInputSchema.safeParse({
    workspace_root: '/tmp/workspace',
    scope: 'all',
    max_bytes: 1024,
    context_lines: 2
  }).success, true)

  assert.equal(GitDiffPreviewInputSchema.safeParse({
    workspace_root: '/tmp/workspace',
    scope: 'delete_everything'
  }).success, false)

  assert.equal(GitDiffPreviewInputSchema.safeParse({
    workspace_root: '/tmp/workspace',
    max_bytes: 999_999
  }).success, false)
})

test('validates LSP query boundaries', () => {
  assert.equal(LspQueryInputSchema.safeParse({
    workspace_root: '/tmp/workspace',
    operation: 'workspaceSymbol',
    query: 'RuntimeInspector'
  }).success, true)

  assert.equal(LspQueryInputSchema.safeParse({
    workspace_root: '/tmp/workspace',
    operation: 'hover',
    file_path: 'src/index.ts'
  }).success, false)

  assert.equal(LspQueryInputSchema.safeParse({
    workspace_root: '/tmp/workspace',
    operation: 'documentSymbol'
  }).success, false)

  assert.equal(LspQueryInputSchema.safeParse({
    workspace_root: '/tmp/workspace',
    operation: 'documentSymbol',
    file_path: 'src/index.ts',
    unsaved_buffers: []
  }).success, false)
})

test('publishes stable tool names and encoded resource URIs', () => {
  assert.ok(RuntimeInspectorToolNames.includes('gui_git_status'))
  assert.ok(RuntimeInspectorToolNames.includes('gui_runtime_status'))
  assert.ok(RuntimeInspectorToolNames.includes('gui_lsp_query'))
  assert.ok(RuntimeInspectorToolNames.includes('gui_completion_check'))
  assert.equal(gitDiffResourceUri('src/app file.ts'), 'git://diff/src/app%20file.ts')
})
