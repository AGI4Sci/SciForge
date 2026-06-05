import { createServer } from 'node:http';
import { handleCodexRuntimeRoutes, handleCodexRuntimeUpgrade } from './codex-runtime-server.js';
import { createCodexAppServerRuntimeAdapter } from './codex-runtime-adapter.js';
import { createDefaultCodexAgentHostRuntimeTruthResolver } from './agent-host-runtime-truth-resolver.js';
import { createDefaultComputerUseActMaterializer } from './agent-host-computer-use-act-materializer.js';
import { writeJson } from '../server/http.js';

const port = Number(process.env.SCIFORGE_RUNTIME_CODEX_PORT || 0);
const host = process.env.SCIFORGE_RUNTIME_CODEX_HOST || '127.0.0.1';
const startedAt = new Date().toISOString();
const agentHostRuntimeTruthResolver = createDefaultCodexAgentHostRuntimeTruthResolver({ env: process.env });
const computerUseActMaterializer = createDefaultComputerUseActMaterializer({ env: process.env });

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port || 0}`}`);
  if (url.pathname === '/health' && req.method === 'GET') {
    writeJson(res, 200, {
      ok: true,
      service: 'sciforge-runtime-codex',
      schemaVersion: 'sciforge.runtime-codex.standalone-health.v1',
      pid: process.pid,
      startedAt,
    });
    return;
  }

  if (await handleCodexRuntimeRoutes(req, res, url, createCodexAppServerRuntimeAdapter({ env: process.env }), {
    agentHostRuntimeTruthResolver,
    computerUseActMaterializer,
  })) return;
  writeJson(res, 404, { ok: false, error: 'not found' });
});

server.on('upgrade', (req, socket, head) => {
  if (!handleCodexRuntimeUpgrade(req, socket, head, createCodexAppServerRuntimeAdapter({ env: process.env }), {
    agentHostRuntimeTruthResolver,
    computerUseActMaterializer,
  })) socket.destroy();
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`SciForge Runtime Codex sidecar: http://${host}:${actualPort}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
