/**
 * example-bio-chem-tool — Local SCP Skill Invoke Wrapper
 *
 * Usage:
 *   node index.js <action> [params-json]
 *
 * Examples:
 *   node index.js calculate '{"smiles":"CCO","properties":["mw","logp","tpsa"]}'
 *
 * This wrapper calls the local invokeMcpTool logic via the MCP JSON-RPC 2.0 protocol.
 * Requires SCPhub_api_key (Bearer token) and SCPhub_base_url configured in openteam.json.
 *
 * For local development / mock mode, set MOCK_MODE=1 to use built-in mock responses.
 */

const MOCK_MODE = process.env.MOCK_MODE === '1';

const TOOL_ID = 'example-bio-chem-tool';
const API_BASE = process.env.SCPhub_base_url || 'https://scphub.intern-ai.org.cn';

/**
 * Mock implementation mirroring invoke.ts mockInvokeTool
 */
function mockCalculate(params) {
  const smiles = params.smiles || 'CCO';
  return {
    success: true,
    result: {
      toolId: TOOL_ID,
      action: 'calculate',
      smiles,
      properties: {
        molecularWeight: '46.07 Da',
        molecularFormula: 'C2H6O',
        logP: '-0.31',
        tpsa: '20.23',
        note: 'Mock result — MOCK_MODE=1'
      }
    },
    executionTime: Math.floor(Math.random() * 100 + 50)
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