import { EvidenceRuntime } from './runtime.js'
import type { EvidencePorts } from '@sciforge/domain-evidence-dag/host/ports'
/** Non-registering static contrast entry: shares the fact owner and the same minimal ports.
 * The native Context-to-ports implementation remains Host-side; no Context reaches core.
 */
export function createStaticEvidenceAdapter(ports: EvidencePorts, options?: { now?: () => Date }) {
  return new EvidenceRuntime(ports, options)
}
