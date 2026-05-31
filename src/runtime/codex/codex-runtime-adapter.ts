import { CodexAppServerAdapter } from './codex-app-server-adapter.js';
import { createCodexAppServerClient, type CodexAppServerJsonRpcClientOptions } from './codex-app-server-client.js';

export function createCodexAppServerRuntimeAdapter(options: CodexAppServerJsonRpcClientOptions = {}) {
  return new CodexAppServerAdapter({
    client: createCodexAppServerClient(options),
    provider: 'codex-app-server',
    model: 'app-server-native',
  });
}
