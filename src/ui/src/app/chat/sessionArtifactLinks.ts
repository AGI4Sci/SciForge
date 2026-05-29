import type { NormalizedAgentResponse } from '../../domain';

export function mergeRuntimeArtifacts(
  primary: NormalizedAgentResponse['artifacts'],
  secondary: NormalizedAgentResponse['artifacts'],
) {
  const byKey = new Map<string, NormalizedAgentResponse['artifacts'][number]>();
  for (const artifact of [...secondary, ...primary]) {
    const key = artifact.id || artifact.path || artifact.dataRef || `${artifact.type}-${byKey.size}`;
    const previous = byKey.get(key);
    if (byKey.has(key)) byKey.delete(key);
    byKey.set(key, { ...previous, ...artifact });
  }
  return Array.from(byKey.values()).slice(-32);
}
