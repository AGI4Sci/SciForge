/**
 * molecular-properties-calculation — Local SCP Skill Invoke Wrapper
 *
 * Usage:
 *   node index.js calculate [params-json]
 *
 * Examples:
 *   node index.js calculate '{"smiles":"CCO"}'
 *   MOCK_MODE=1 node index.js calculate '{"smiles":"CCO"}'
 *
 * Mock mode returns estimated molecular properties when no API key is available.
 * Matches the server/api/scp-tools/invoke.ts mock implementation for skill 112.
 */

const MOCK_MODE = process.env.MOCK_MODE === '1';

const TOOL_ID = 'molecular-properties-calculation';
const API_BASE = process.env.SCPhub_base_url || 'https://scphub.intern-ai.org.cn';

/** Rough mock for common molecules — used when MOCK_MODE=1 or no API key */
function mockCalculate(params) {
  const smiles = params.smiles || 'CCO';
  // Very rough estimates: just length-based fallback matching invoke.ts pattern
  const length = smiles.length;
  return {
    success: true,
    result: {
      toolId: TOOL_ID,
      action: 'calculate',
      input: smiles,
      properties: {
        molecularWeight: `${(length * 6.5).toFixed(2)} Da`,
        molecularFormula: 'C?H?O?',
        exactMolecularWeight: `${(length * 6.4).toFixed(2)} Da`,
        atomCount: length * 3,
        heavyAtomCount: length
      },
      note: 'Mock result — agents/skills/scp/molecular-properties-calculation (T006)'
    },
    executionTime: 0
  };
}

async function invokeMcpTool(action, params) {
  const apiKey = process.env.SCPhub_api_key;
  if (!apiKey) {
    // Fall back to mock when no key is configured
    return mockCalculate(params);
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