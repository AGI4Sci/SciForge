// Test-only consumer of Host types. Production package never imports Host-private modules.
import type { AgentRuntimeAdapter } from '../../../../src/main/runtime/agent-runtime/adapter'
import type { DshRuntimeAdapter } from '../src/index'
declare const adapter: DshRuntimeAdapter
const compatible: AgentRuntimeAdapter = adapter
void compatible
