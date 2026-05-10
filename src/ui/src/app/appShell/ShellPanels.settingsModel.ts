import type { PeerInstance } from '../../domain';

export function nextPeerInstanceName(peerInstances: PeerInstance[]) {
  const existingNames = new Set(peerInstances.map((peer) => peer.name.trim().toLowerCase()).filter(Boolean));
  let suffix = peerInstances.length + 1;
  let name = `peer-${suffix}`;
  while (existingNames.has(name.toLowerCase())) {
    suffix += 1;
    name = `peer-${suffix}`;
  }
  return name;
}

export function createDefaultPeerInstance(peerInstances: PeerInstance[]): PeerInstance {
  return {
    name: nextPeerInstanceName(peerInstances),
    appUrl: '',
    workspaceWriterUrl: '',
    workspacePath: '',
    role: 'peer',
    trustLevel: 'readonly',
    enabled: true,
  };
}

export function appendPeerInstance(peerInstances: PeerInstance[]) {
  return [...peerInstances, createDefaultPeerInstance(peerInstances)];
}

export function updatePeerInstanceAt(peerInstances: PeerInstance[], index: number, patch: Partial<PeerInstance>) {
  return peerInstances.map((peer, peerIndex) => (peerIndex === index ? { ...peer, ...patch } : peer));
}

export function removePeerInstanceAt(peerInstances: PeerInstance[], index: number) {
  return peerInstances.filter((_, peerIndex) => peerIndex !== index);
}
