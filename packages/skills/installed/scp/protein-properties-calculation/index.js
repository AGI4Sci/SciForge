/**
 * protein-properties-calculation — Local SCP Skill Invoke Wrapper
 *
 * Usage:
 *   node index.js <action> [params-json]
 *
 * Examples:
 *   node index.js calculate '{"sequence":"MKFLILLFNILCLFPVLAADNH"}'
 *   MOCK_MODE=1 node index.js calculate '{"sequence":"MKFLILLFNILCLFPVLAADNH"}'
 *
 * Mock mode uses built-in estimation (sequence_length * 110 Da, random pI, etc.)
 * matching the server/api/scp-tools/invoke.ts mock implementation.
 */

const MOCK_MODE = process.env.MOCK_MODE === '1';

const TOOL_ID = 'protein-properties-calculation';
const API_BASE = process.env.SCPhub_base_url || 'https://scphub.intern-ai.org.cn';

function random(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Mock implementation matching invoke.ts mockInvokeTool
 */
function mockCalculate(params) {
  const sequence = params.sequence || params.protein || 'MKFLILLFNILCLFPVLAADNH';
  const length = sequence.length;
  return {
    success: true,
    result: {
      toolId: TOOL_ID,
      action: 'calculate',
      sequence: length > 50 ? sequence.slice(0, 50) + '...' : sequence,
      sequenceLength: length,
      properties: {
        molecularWeight: `${(length * 110).toFixed(2)} Da`,
        isoelectricPoint: (6.5 + random(0, 2)).toFixed(2),
        instabilityIndex: (30 + random(0, 20)).toFixed(2),
        aliphaticIndex: (80 + random(0, 20)).toFixed(2),
        gravy: (-0.5 + random(0, 1)).toFixed(3),
        aminoAcidComposition: {
          Ala: '8.5%', Leu: '12.3%', Val: '6.2%', Ile: '5.8%',
          Pro: '4.2%', Phe: '3.5%', Trp: '1.2%', Met: '2.1%',
          Gly: '7.4%', Ser: '6.8%', Thr: '5.5%', Cys: '1.8%',
          Tyr: '3.2%', Asn: '4.1%', Gln: '3.8%', Asp: '5.2%',
          Glu: '6.1%', Lys: '5.8%', Arg: '4.5%', His: '2.2%'
        }
      },
      note: 'Mock result — agents/skills/scp/protein-properties-calculation (T006)'
    },
    executionTime: Math.floor(random(300, 800))
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
  const [, , action = 'calculate', paramsJson = '{}'] = process.argv;
  let params;
  try {
    params = JSON.parse(paramsJson);
  } catch {
    console.error('Error: params must be valid JSON');
    process.exit(1);
  }

  try {
    const result = MOCK_MODE ? mockCalculate(params) : await invokeMcpTool(action, params);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

main();