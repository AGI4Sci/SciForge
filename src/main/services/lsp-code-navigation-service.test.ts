import { chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../../shared/app-settings'
import type { AgentRuntimeAdapter } from '../runtime/agent-runtime/adapter'
import { createAgentRuntimeHost } from '../runtime/agent-runtime/host'
import { LspCodeNavigationService } from './lsp-code-navigation-service'

const FAKE_TS_LS = `#!/usr/bin/env node
let buffer = Buffer.alloc(0);
let workspaceUri = 'file:///workspace';
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\\r\\n\\r\\n' + body);
}
function handle(message) {
  if (!message || typeof message !== 'object' || message.id === undefined) return;
  const params = message.params || {};
  const uri = params.textDocument && params.textDocument.uri ? params.textDocument.uri : workspaceUri.replace(/\\/$/, '') + '/src/main.ts';
  if (message.method === 'initialize') {
    workspaceUri = params.rootUri || workspaceUri;
    send({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } });
    return;
  }
  if (message.method === 'textDocument/documentSymbol') {
    send({ jsonrpc: '2.0', id: message.id, result: [{
      name: 'answer',
      kind: 12,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 21 } },
      selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } }
    }] });
    return;
  }
  if (message.method === 'textDocument/definition' || message.method === 'textDocument/implementation') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      uri,
      range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } }
    } });
    return;
  }
  if (message.method === 'textDocument/references') {
    send({ jsonrpc: '2.0', id: message.id, result: [{
      uri,
      range: { start: { line: 1, character: 7 }, end: { line: 1, character: 13 } }
    }] });
    return;
  }
  if (message.method === 'textDocument/hover') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      contents: { kind: 'markdown', value: '**answer**: number' }
    } });
    return;
  }
  if (message.method === 'workspace/symbol') {
    send({ jsonrpc: '2.0', id: message.id, result: [{
      name: 'answer',
      kind: 12,
      location: {
        uri,
        range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } }
      }
    }] });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, result: null });
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
`

async function workspaceWithFakeTsLs(): Promise<{ workspaceRoot: string; sourcePath: string }> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-lsp-'))
  const sourceDir = join(workspaceRoot, 'src')
  const binDir = join(workspaceRoot, 'node_modules', '.bin')
  await mkdir(sourceDir, { recursive: true })
  await mkdir(binDir, { recursive: true })
  await writeFile(join(sourceDir, 'main.ts'), 'export const answer = 42\nanswer\n', 'utf8')
  const serverJs = join(workspaceRoot, 'fake-typescript-language-server.cjs')
  await writeFile(serverJs, FAKE_TS_LS.replace('#!/usr/bin/env node\n', ''), 'utf8')
  const serverPath = join(binDir, process.platform === 'win32' ? 'typescript-language-server.cmd' : 'typescript-language-server')
  const launcher = process.platform === 'win32'
    ? `@"${process.execPath}" "${serverJs}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${serverJs}" "$@"\n`
  await writeFile(serverPath, launcher, 'utf8')
  await chmod(serverPath, 0o755)
  return { workspaceRoot, sourcePath: await realpath(join(sourceDir, 'main.ts')) }
}

function adapter(runtimeId: 'codex' | 'claude' | 'dsh'): AgentRuntimeAdapter {
  return {
    id: runtimeId,
    transport: runtimeId === 'claude' ? 'cli_process' : 'jsonrpc_stdio'
  } as AgentRuntimeAdapter
}

describe('LspCodeNavigationService', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('queries a workspace-local language server and returns simplified code navigation results', async () => {
    vi.stubEnv('PATH', '/definitely-empty')
    const { workspaceRoot, sourcePath } = await workspaceWithFakeTsLs()
    const service = new LspCodeNavigationService()
    try {
      await expect(service.query({
        workspaceRoot,
        operation: 'documentSymbol',
        filePath: 'src/main.ts'
      })).resolves.toMatchObject({
        ok: true,
        value: {
          operation: 'documentSymbol',
          filePath: sourcePath,
          result: [{ name: 'answer', kind: 'Function' }]
        }
      })

      await expect(service.query({
        workspaceRoot,
        operation: 'goToDefinition',
        filePath: 'src/main.ts',
        line: 1,
        character: 14
      })).resolves.toMatchObject({
        ok: true,
        value: {
          operation: 'goToDefinition',
          result: {
            path: sourcePath,
            range: {
              start: { line: 1, character: 10 }
            }
          }
        }
      })

      await expect(service.query({
        workspaceRoot,
        operation: 'workspaceSymbol',
        query: 'answer'
      })).resolves.toMatchObject({
        ok: true,
        value: {
          operation: 'workspaceSymbol',
          result: [{ name: 'answer', path: sourcePath }]
        }
      })
    } finally {
      service.shutdown()
    }
  })

  it('returns a recoverable error when no TypeScript language server is available', async () => {
    vi.stubEnv('PATH', '/definitely-empty')
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-lsp-missing-'))
    await writeFile(join(workspaceRoot, 'main.ts'), 'export const answer = 42\n', 'utf8')
    const service = new LspCodeNavigationService()
    try {
      await expect(service.query({
        workspaceRoot,
        operation: 'documentSymbol',
        filePath: 'main.ts'
      })).resolves.toMatchObject({
        ok: false,
        failure: {
          code: 'language_server_missing',
          recoverable: true,
          severity: 'warning'
        }
      })
    } finally {
      service.shutdown()
    }
  })

  it('routes code navigation through the shared host service for every runtime', async () => {
    vi.stubEnv('PATH', '/definitely-empty')
    const { workspaceRoot, sourcePath } = await workspaceWithFakeTsLs()
    const service = new LspCodeNavigationService()
    const host = createAgentRuntimeHost({
      settings: async () => ({
        activeAgentRuntime: 'codex',
        workspaceRoot
      }) as AppSettingsV1,
      adapters: [adapter('dsh'), adapter('codex'), adapter('claude')],
      services: { codeNavigation: service }
    })
    try {
      for (const runtimeId of ['dsh', 'codex', 'claude'] as const) {
        for (const operation of ['goToDefinition', 'findReferences'] as const) {
          await expect(host.auxiliary({
            runtimeId,
            operation: 'runCodeNavigation',
            payload: {
              workspaceRoot,
              operation,
              filePath: 'src/main.ts',
              line: 2,
              character: 2
            }
          })).resolves.toMatchObject({
            ok: true,
            value: {
              operation,
              filePath: sourcePath,
              ...(operation === 'goToDefinition'
                ? {
                    result: {
                      path: sourcePath,
                      range: {
                        start: { line: 1, character: 10 }
                      }
                    }
                  }
                : {
                    result: [{
                      path: sourcePath,
                      range: {
                        start: { line: 2, character: 8 }
                      }
                    }]
                  })
            }
          })
        }
      }
    } finally {
      service.shutdown()
    }
  })
})
