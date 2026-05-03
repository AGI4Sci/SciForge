/**
 * sequence-alignment-pairwise — Local SCP Skill Invoke Wrapper
 *
 * Usage:
 *   node index.js <action> [params-json]
 *
 * Examples:
 *   node index.js align '{"seq_a":"ATGCGTCA","seq_b":"ATGGGTCA"}'
 *   MOCK_MODE=1 node index.js align '{"seq_a":"ATGCGTCA","seq_b":"ATGGGTCA"}'
 *
 * Mock mode returns a simulated alignment with identity percentage,
 * matching the server/api/scp-tools/invoke.ts mock implementation.
 * The mock is used for offline development and T006 smoke testing.
 */

const MOCK_MODE = process.env.MOCK_MODE === '1';

const TOOL_ID = 'sequence-alignment-pairwise';
const API_BASE = process.env.SCPhub_base_url || 'https://scphub.intern-ai.org.cn';

/**
 * Mock implementation matching invoke.ts mockInvokeTool — the one tool
 * with a dedicated mock branch (no getTool lookup required).
 */
function mockAlign(params) {
  const seqA = params.seq_a || params.seqA || params.a || 'ATGC';
  const seqB = params.seq_b || params.seqB || params.b || 'ATGG';
  const identity = (82 + Math.random() * 15).toFixed(1);

  return {
    success: true,
    result: {
      toolId: TOOL_ID,
      action: 'align',
      seqA: String(seqA).slice(0, 120),
      seqB: String(seqB).slice(0, 120),
      identityPercent: identity,
      alignment: {
        alignedSeqA: String(seqA).slice(0, 80),
        alignedSeqB: String(seqB).slice(0, 80),
        gaps: Math.abs(String(seqA).length - String(seqB).length),
        matchPositions: Math.floor(Math.min(String(seqA).length, String(seqB).length) * parseFloat(identity) / 100)
      },
      scoring: {
        gapOpen: -10,
        gapExtend: -1,
        match: 2,
        mismatch: -1,
        rawScore: Math.floor(Math.random() * 20 + 10)
      },
      note: 'Mock pairwise alignment — agents/skills/scp/sequence-alignment-pairwise (T006); use Hub catalog when available'
    },
    executionTime: Math.floor(Math.random() * 200 + 100)
  };
}

/**
 * Invoke via MCP JSON-RPC 2.0 over HTTP
 */
async function invokeMcpTool(action, params) {
  const apiKey = process.env.SCPhub_api_key;
  if (!apiKey) {
    throw new Error('SCPhub_api_key not configured. Set SCPhub_api_key env var or configure openteam.json.');
  }

  const mcpRequest = {
    jsonrpc: '2.0',
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method: 'tools/call',
    params: {
      name: `${TOOL_ID}_${action}`,
      arguments: params
    }
  };

  const response = await fetch(`${API_BASE}/api/mcp/v1/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(mcpRequest)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  return {
    success: true,
    result: data.result?.content || data.result,
    executionTime: 0
  };
}

async function main() {
  const [, , action = 'align', paramsJson = '{}'] = process.argv;
  let params;
  try {
    params = JSON.parse(paramsJson);
  } catch {
    console.error('Error: params must be valid JSON');
    process.exit(1);
  }

  try {
    const result = MOCK_MODE ? mockAlign(params) : await invokeMcpTool(action, params);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

main();