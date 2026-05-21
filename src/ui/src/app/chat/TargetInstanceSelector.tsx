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
        <span>目标工作区</span>
        <select
          value={selectedPeer ? selectedPeer.name : CURRENT_TARGET_INSTANCE_VALUE}
          onChange={(event) => onSelect(event.currentTarget.value)}
          aria-label="目标工作区"
        >
          <option value={CURRENT_TARGET_INSTANCE_VALUE}>当前实例</option>
          {peers.map((peer) => (
            <option key={`${peer.name}-${peer.workspaceWriterUrl}`} value={peer.name}>
              {peer.name}
            </option>
          ))}
        </select>
      </label>
      {selectedPeer ? (
        <div className="target-instance-warning" role="status">
          <strong>当前正在读取并修改目标工作区</strong>
          <span>{selectedPeer.name}{selectedPeer.workspacePath ? ` · ${selectedPeer.workspacePath}` : ' · 已连接目标 writer'}</span>
        </div>
      ) : null}
    </div>
  );
}
