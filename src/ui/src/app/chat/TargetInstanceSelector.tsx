import { ServerCog } from 'lucide-react';
import type { PeerInstance } from '../../domain';
import { CURRENT_TARGET_INSTANCE_VALUE } from './targetInstance';

export function TargetInstanceSelector({
  peers,
  selected,
  onSelect,
}: {
  peers: PeerInstance[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const selectedPeer = peers.find((peer) => peer.name === selected);
  if (!peers.length && !selectedPeer) return null;
  return (
    <div className="target-instance-selector" data-peer-active={selectedPeer ? 'true' : 'false'}>
      <label>
        <ServerCog size={14} />
        <span>Target workspace</span>
        <select
          value={selectedPeer ? selectedPeer.name : CURRENT_TARGET_INSTANCE_VALUE}
          onChange={(event) => onSelect(event.currentTarget.value)}
          aria-label="Target workspace"
        >
          <option value={CURRENT_TARGET_INSTANCE_VALUE}>Current workspace</option>
          {peers.map((peer) => (
            <option key={`${peer.name}-${peer.workspaceWriterUrl}`} value={peer.name}>
              {peer.name}
            </option>
          ))}
        </select>
      </label>
      {selectedPeer ? (
        <div className="target-instance-warning" role="status">
          <strong>Using target workspace</strong>
          <span>{selectedPeer.name}{selectedPeer.workspacePath ? ` · ${selectedPeer.workspacePath}` : ' · connected'}</span>
        </div>
      ) : null}
    </div>
  );
}
