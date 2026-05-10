import { useEffect } from 'react';
import { ChevronDown, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { validatePeerInstances } from '../../config';
import type { PeerInstance, SciForgeConfig } from '../../domain';
import { RuntimeHealthPanel, useRuntimeHealth } from '../runtimeHealthPanel';
import { ActionButton, IconButton, cx } from '../uiPrimitives';
import {
  appendPeerInstance,
  removePeerInstanceAt,
  updatePeerInstanceAt,
} from './ShellPanels.settingsModel';
import { settingsSaveStateText, type ConfigSaveState } from './settingsModels';

export function SettingsDialog({
  config,
  onChange,
  saveState,
  onSave,
  onClose,
}: {
  config: SciForgeConfig;
  onChange: (patch: Partial<SciForgeConfig>) => void;
  saveState: ConfigSaveState;
  onSave: () => void;
  onClose: () => void;
}) {
  const healthItems = useRuntimeHealth(config);
  const peerInstances = config.peerInstances ?? [];
  const peerValidationErrors = validatePeerInstances(peerInstances);
  const updatePeerInstance = (index: number, patch: Partial<PeerInstance>) => {
    onChange({ peerInstances: updatePeerInstanceAt(peerInstances, index, patch) });
  };
  const addPeerInstance = () => {
    onChange({ peerInstances: appendPeerInstance(peerInstances) });
  };
  const removePeerInstance = (index: number) => {
    onChange({ peerInstances: removePeerInstanceAt(peerInstances, index) });
  };
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="SciForge 设置" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <div>
            <h2>设置</h2>
            <p>统一配置 AgentServer、模型连接和本地 workspace。</p>
          </div>
          <IconButton icon={ChevronDown} label="关闭设置" onClick={onClose} />
        </div>
        <RuntimeHealthPanel items={healthItems} />
        <div className="settings-grid">
          <label>
            <span>界面主题</span>
            <select value={config.theme} onChange={(event) => onChange({ theme: event.target.value === 'light' ? 'light' : 'dark' })}>
              <option value="dark">黑夜</option>
              <option value="light">白天</option>
            </select>
          </label>
          <label>
            <span>AgentServer Base URL</span>
            <input value={config.agentServerBaseUrl} onChange={(event) => onChange({ agentServerBaseUrl: event.target.value })} />
          </label>
          <label>
            <span>Workspace Writer URL</span>
            <input value={config.workspaceWriterBaseUrl} onChange={(event) => onChange({ workspaceWriterBaseUrl: event.target.value })} />
          </label>
          <label className="wide">
            <span>Workspace Path</span>
            <input value={config.workspacePath} onChange={(event) => onChange({ workspacePath: event.target.value })} />
          </label>
          <div className="wide settings-peer-section">
            <div className="settings-peer-section-head">
              <span>Peer Instances</span>
              <ActionButton icon={Plus} variant="secondary" onClick={addPeerInstance}>新增 Peer</ActionButton>
            </div>
            {peerInstances.length ? (
              <div className="settings-peer-list">
                {peerInstances.map((peer, index) => (
                  <div className="settings-peer-card" key={`${peer.name}-${index}`}>
                    <label className="settings-check-row settings-peer-enabled">
                      <input
                        type="checkbox"
                        checked={peer.enabled}
                        onChange={(event) => updatePeerInstance(index, { enabled: event.target.checked })}
                      />
                      <span>{peer.enabled ? '启用' : '禁用'}</span>
                    </label>
                    <label>
                      <span>Name</span>
                      <input value={peer.name} onChange={(event) => updatePeerInstance(index, { name: event.target.value })} />
                    </label>
                    <label>
                      <span>Role</span>
                      <select value={peer.role} onChange={(event) => updatePeerInstance(index, { role: event.target.value as PeerInstance['role'] })}>
                        <option value="main">main</option>
                        <option value="repair">repair</option>
                        <option value="peer">peer</option>
                      </select>
                    </label>
                    <label>
                      <span>Trust Level</span>
                      <select value={peer.trustLevel} onChange={(event) => updatePeerInstance(index, { trustLevel: event.target.value as PeerInstance['trustLevel'] })}>
                        <option value="readonly">readonly</option>
                        <option value="repair">repair</option>
                        <option value="sync">sync</option>
                      </select>
                    </label>
                    <label>
                      <span>App URL</span>
                      <input value={peer.appUrl} onChange={(event) => updatePeerInstance(index, { appUrl: event.target.value })} placeholder="http://127.0.0.1:5173" />
                    </label>
                    <label>
                      <span>Workspace Writer URL</span>
                      <input value={peer.workspaceWriterUrl} onChange={(event) => updatePeerInstance(index, { workspaceWriterUrl: event.target.value })} placeholder="http://127.0.0.1:5174" />
                    </label>
                    <label className="settings-peer-path">
                      <span>Workspace Path</span>
                      <input value={peer.workspacePath} onChange={(event) => updatePeerInstance(index, { workspacePath: event.target.value })} />
                    </label>
                    <ActionButton icon={Trash2} variant="secondary" onClick={() => removePeerInstance(index)}>删除</ActionButton>
                  </div>
                ))}
              </div>
            ) : (
              <p className="settings-peer-empty">还没有配置 Peer Instance。</p>
            )}
            {peerValidationErrors.length ? (
              <div className="settings-validation" role="alert">
                {peerValidationErrors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
          </div>
          <label>
            <span>Agent Backend</span>
            <select value={config.agentBackend} onChange={(event) => onChange({ agentBackend: event.target.value })}>
              <option value="codex">Codex</option>
              <option value="openteam_agent">OpenTeam Agent</option>
              <option value="claude-code">Claude Code</option>
              <option value="hermes-agent">Hermes Agent</option>
              <option value="openclaw">OpenClaw</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label>
            <span>Model Provider</span>
            <select value={config.modelProvider} onChange={(event) => onChange({ modelProvider: event.target.value })}>
              <option value="native">native user endpoint</option>
              <option value="openai-compatible">openai-compatible</option>
              <option value="openrouter">openrouter</option>
              <option value="qwen">qwen</option>
              <option value="codex-chatgpt">codex-chatgpt</option>
              <option value="gemini">gemini</option>
            </select>
          </label>
          <label>
            <span>Model Name</span>
            <input value={config.modelName} onChange={(event) => onChange({ modelName: event.target.value })} placeholder="gpt-5.4 / local-model / ..." />
          </label>
          <label>
            <span>Model Base URL</span>
            <input value={config.modelBaseUrl} onChange={(event) => onChange({ modelBaseUrl: event.target.value })} placeholder="https://.../v1" />
          </label>
          <label>
            <span>API Key</span>
            <input type="password" value={config.apiKey} onChange={(event) => onChange({ apiKey: event.target.value })} placeholder="stored in local config.json" />
          </label>
          <label>
            <span>Timeout ms</span>
            <input
              type="number"
              min={30000}
              step={10000}
              value={config.requestTimeoutMs}
              onChange={(event) => onChange({ requestTimeoutMs: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Max Context Window (k tokens)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={Math.round(config.maxContextWindowTokens / 1000)}
              onChange={(event) => onChange({ maxContextWindowTokens: Number(event.target.value) * 1000 })}
            />
          </label>
          <label className="wide settings-check-row">
            <input
              type="checkbox"
              checked={config.visionAllowSharedSystemInput}
              onChange={(event) => onChange({ visionAllowSharedSystemInput: event.target.checked })}
            />
            <span>默认允许 vision-sense 使用共享系统鼠标/键盘</span>
          </label>
          <label className="wide">
            <span>反馈 GitHub 仓库</span>
            <input
              value={config.feedbackGithubRepo ?? ''}
              onChange={(event) => onChange({ feedbackGithubRepo: event.target.value.trim() || undefined })}
              placeholder="默认 AGI4Sci/SciForge；可改为 fork 或完整 https://github.com/… URL"
            />
          </label>
          <label className="wide">
            <span>反馈 GitHub Token（可选）</span>
            <input
              type="password"
              autoComplete="off"
              value={config.feedbackGithubToken ?? ''}
              onChange={(event) => onChange({ feedbackGithubToken: event.target.value.trim() || undefined })}
              placeholder="classic PAT 或 fine-grained PAT（需 Issues 读写；仅存本地）"
            />
          </label>
        </div>
        <div className="settings-save-state" role="status">
          <span className={cx('status-dot', saveState.status === 'error' ? 'offline' : saveState.status === 'saving' ? 'optional' : 'online')} />
          <span>
            {settingsSaveStateText(saveState)}
            {' '}
            下一次 AgentServer 请求会使用当前模型：
            {' '}
            <code>{config.agentBackend}</code>
            <strong>{config.modelProvider || 'native'}</strong>
            {config.modelName.trim() ? <code>{config.modelName.trim()}</code> : <em>user model not set</em>}
          </span>
          <ActionButton icon={Save} variant="primary" onClick={onSave} disabled={saveState.status === 'saving' || peerValidationErrors.length > 0}>
            {saveState.status === 'saving' ? '保存中' : '保存并生效'}
          </ActionButton>
          <ActionButton icon={RefreshCw} variant="secondary" onClick={() => window.location.reload()}>重新检测连接</ActionButton>
        </div>
      </section>
    </div>
  );
}
