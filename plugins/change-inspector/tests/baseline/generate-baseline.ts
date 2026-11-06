/**
 * The archived golden is a legacy business-diff oracle. Never regenerate it
 * from the implementation under test. Print a candidate to stdout for manual
 * review only; this script deliberately cannot overwrite golden.json.
 * Run: node --import tsx tests/baseline/generate-baseline.ts
 */
import { corpusSessions, corpusSteps } from '../cases.js'
import { runPluginScenario } from '../runner.js'

const corpus = await runPluginScenario(corpusSteps(), { sessions: corpusSessions() })
console.log(JSON.stringify({ candidateOnly: true, scenarios: { corpus } }, null, 2))
