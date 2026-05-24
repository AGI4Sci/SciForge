import { useEffect, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { validatePeerInstances } from '../../config';
import type { PeerInstance, SciForgeConfig } from '../../domain';
import { RuntimeHealthPanel, useRuntimeHealth } from '../runtimeHealthPanel';
import { ActionButton, cx } from '../uiPrimitives';
import {
  appendPeerInstance,
  removePeerInstanceAt,
  updatePeerInstanceAt,
} from './ShellPanels.settingsModel';
import {
  modelCatalogPlaceholder,
  modelCatalogStatusText,
  refreshModelCatalog,
  type ModelCatalogState,
} from './settingsModelCatalog';
import {
  maskedSecretValue,
  secretInputPlaceholder,
  secretPresenceLabel,
  settingsSaveStateText,
  type ConfigSaveState,
} from './settingsModels';
import {
  settingsSectionLabel,
  settingsSectionNavItems,
  type SettingsSectionId,
} from './settingsPageModel';

export function SettingsPage({
  config,
  onChange,
  saveState,
  onSave,
  onBack,
  initialSection = 'general',
}: {
  config: SciForgeConfig;
  onChange: (patch: Partial<SciForgeConfig>) => void;
  saveState: ConfigSaveState;
  onSave: () => void;
  onBack: () => void;
  initialSection?: SettingsSectionId;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const healthItems = useRuntimeHealth(config);
  const peerInstances = config.peerInstances ?? [];
  const peerValidationErrors = validatePeerInstances(peerInstances);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogState>({ status: 'idle', models: [] });
  const apiKeyConfigured = Boolean(config.apiKey.trim());
  const apiKeyInputValue = apiKeyVisible || !apiKeyConfigured ? config.apiKey : maskedSecretValue(config.apiKey);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onBack();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  useEffect(() => {
    if (activeSection !== 'models') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void refreshModelCatalog(config, setModelCatalog, controller.signal);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeSection, config.modelProvider, config.modelBaseUrl, config.apiKey]);

  const updatePeerInstance = (index: number, patch: Partial<PeerInstance>) => {
    onChange({ peerInstances: updatePeerInstanceAt(peerInstances, index, patch) });
  };
  const addPeerInstance = () => {
    onChange({ peerInstances: appendPeerInstance(peerInstances) });
  };
  const removePeerInstance = (index: number) => {
    onChange({ peerInstances: removePeerInstanceAt(peerInstances, index) });
  };

  return (
    <div className="settings-page" aria-label="SciForge 设置">
      <nav className="settings-page-nav" aria-label="设置分类">
        <button type="button" className="settings-page-back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden />
          返回应用
        </button>
        <ul className="settings-page-nav-list">
          {settingsSectionNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={cx('settings-page-nav-item', activeSection === item.id && 'active')}
                  aria-current={activeSection === item.id ? 'page' : undefined}
                  onClick={() => setActiveSection(item.id)}
                >
                  <Icon size={16} aria-hidden />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="settings-page-main">
        <header className="settings-page-header">
          <h1>{settingsSectionLabel(activeSection)}</h1>
          <p>{settingsSectionNavItems.find((item) => item.id === activeSection)?.description}</p>
        </header>
        <div className="settings-page-body">
          {activeSection === 'general' ? (
            <div className="settings-grid">
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
            </div>
          ) : null}
          {activeSection === 'appearance' ? (
            <div className="settings-grid">
              <label>
                <span>界面主题</span>
                <select value={config.theme} onChange={(event) => onChange({ theme: event.target.value === 'light' ? 'light' : 'dark' })}>
                  <option value="dark">黑夜</option>
                  <option value="light">白天</option>
                </select>
              </label>
            </div>
          ) : null}
          {activeSection === 'workspace' ? (
            <div className="settings-grid">
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
                          <input value={peer.workspaceWriterUrl} onChange={(event) => updatePeerInstance(index, { workspaceWriterUrl: event.target.value })} placeholder="http://127.0.0.1:6174" />
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
            </div>
          ) : null}
          {activeSection === 'models' ? (
            <div className="settings-grid">
              <div className="wide settings-peer-section" aria-label="Runtime provider settings">
                <div className="settings-peer-section-head">
                  <span>Runtime Provider</span>
                  <code>{config.apiKey.trim() ? 'API key configured: yes (masked)' : 'API key configured: no'}</code>
                </div>
                <p className="settings-peer-empty">Main chat Runtime Codex and repair Codex CLI share this provider, model, upstream Chat Completions URL, Runtime Profile, and API key. The local Responses proxy is internal compatibility plumbing.</p>
              </div>
              <label>
                <span>Runtime Backend</span>
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
                <span>Runtime Profile</span>
                <input value={config.runtimeProfile ?? ''} onChange={(event) => onChange({ runtimeProfile: event.target.value })} placeholder="sciforge-runtime-deepseek" />
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
                <span>Model</span>
                <input value={config.modelName} onChange={(event) => onChange({ modelName: event.target.value })} placeholder="gpt-5.4 / local-model / ..." />
              </label>
              <div className="wide settings-model-catalog">
                <div className="settings-peer-section-head">
                  <span>Provider Models</span>
                  <ActionButton
                    icon={RefreshCw}
                    variant="secondary"
                    onClick={() => void refreshModelCatalog(config, setModelCatalog)}
                    disabled={modelCatalog.status === 'loading'}
                  >
                    {modelCatalog.status === 'loading' ? '查询中' : '刷新模型'}
                  </ActionButton>
                </div>
                <div className="settings-model-picker">
                  <label>
                    <span>可用模型</span>
                    <select
                      value={modelCatalog.models.includes(config.modelName) ? config.modelName : ''}
                      onChange={(event) => {
                        if (event.target.value) onChange({ modelName: event.target.value });
                      }}
                      disabled={!modelCatalog.models.length}
                    >
                      <option value="">{modelCatalogPlaceholder(modelCatalog)}</option>
                      {modelCatalog.models.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <p className={cx('settings-model-catalog-status', modelCatalog.status === 'error' ? 'error' : undefined)}>
                    {modelCatalogStatusText(modelCatalog)}
                  </p>
                </div>
              </div>
              <label>
                <span>Provider Base URL</span>
                <input value={config.modelBaseUrl} onChange={(event) => onChange({ modelBaseUrl: event.target.value })} placeholder="https://.../v1" />
              </label>
              <label>
                <span>API Key</span>
                <div className="settings-secret-input">
                  <input
                    type={apiKeyVisible ? 'text' : 'password'}
                    autoComplete="off"
                    value={apiKeyInputValue}
                    readOnly={apiKeyConfigured && !apiKeyVisible}
                    onChange={(event) => onChange({ apiKey: event.target.value })}
                    placeholder={secretInputPlaceholder(config.apiKey, 'stored in local config.json')}
                    aria-describedby="settings-api-key-status"
                  />
                  <button
                    type="button"
                    className="settings-secret-toggle"
                    aria-label={apiKeyVisible ? '隐藏 API key' : '查看 API key'}
                    title={apiKeyVisible ? '隐藏 API key' : '查看 API key'}
                    onClick={() => setApiKeyVisible((visible) => !visible)}
                  >
                    {apiKeyVisible ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  </button>
                </div>
                <small id="settings-api-key-status">{secretPresenceLabel(config.apiKey, 'API key')}</small>
              </label>
              <label className="wide settings-check-row">
                <input
                  type="checkbox"
                  checked={config.allowOpenAiRuntime === true}
                  onChange={(event) => onChange({ allowOpenAiRuntime: event.target.checked })}
                />
                <span>显式允许 Runtime Codex 使用 OpenAI provider</span>
              </label>
            </div>
          ) : null}
          {activeSection === 'connections' ? (
            <div className="settings-grid">
              <label className="wide">
                <span>Codex Runtime Base URL</span>
                <input value={config.agentServerBaseUrl} onChange={(event) => onChange({ agentServerBaseUrl: event.target.value })} />
              </label>
              <div className="wide">
                <RuntimeHealthPanel items={healthItems} />
              </div>
            </div>
          ) : null}
          {activeSection === 'feedback' ? (
            <div className="settings-grid">
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
                  value=""
                  onChange={(event) => onChange({ feedbackGithubToken: event.target.value.trim() || undefined })}
                  placeholder={secretInputPlaceholder(config.feedbackGithubToken, 'classic PAT 或 fine-grained PAT（需 Issues 读写；仅存本地）')}
                  aria-describedby="settings-feedback-github-token-status"
                />
                <small id="settings-feedback-github-token-status">{secretPresenceLabel(config.feedbackGithubToken, 'GitHub token')}</small>
              </label>
              <label className="wide">
                <span>反馈 GitHub Labels</span>
                <input
                  value={(config.feedbackGithubLabels ?? []).join(', ')}
                  onChange={(event) => onChange({ feedbackGithubLabels: event.target.value.split(',').map((label) => label.trim()).filter(Boolean) })}
                  placeholder="feedback, sciforge-inbox"
                />
              </label>
              <label className="wide">
                <span>反馈 GitHub Assignees</span>
                <input
                  value={(config.feedbackGithubAssignees ?? []).join(', ')}
                  onChange={(event) => onChange({ feedbackGithubAssignees: event.target.value.split(',').map((login) => login.trim()).filter(Boolean) })}
                  placeholder="github-login-1, github-login-2"
                />
              </label>
              <label>
                <span>反馈 GitHub Milestone</span>
                <input
                  value={config.feedbackGithubMilestone ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    const numeric = Number(value);
                    onChange({ feedbackGithubMilestone: value && Number.isFinite(numeric) ? numeric : value || undefined });
                  }}
                  placeholder="number 或 title"
                />
              </label>
              <label className="settings-check-row">
                <input
                  type="checkbox"
                  checked={config.feedbackGithubDryRun === true}
                  onChange={(event) => onChange({ feedbackGithubDryRun: event.target.checked })}
                />
                <span>GitHub submit dry-run</span>
              </label>
            </div>
          ) : null}
        </div>
        <footer className="settings-page-footer settings-save-state" role="status">
          <span className={cx('status-dot', saveState.status === 'error' ? 'offline' : saveState.status === 'saving' ? 'optional' : 'online')} />
          <span>
            {settingsSaveStateText(saveState)}
            {' '}
            下一次 Codex Runtime 请求会使用：
            {' '}
            <code>{config.runtimeProfile || 'sciforge-runtime-deepseek'}</code>
            <strong>{config.modelProvider || 'native'}</strong>
            {config.modelName.trim() ? <code>{config.modelName.trim()}</code> : <em>user model not set</em>}
          </span>
          <ActionButton icon={Save} variant="primary" onClick={onSave} disabled={saveState.status === 'saving' || peerValidationErrors.length > 0}>
            {saveState.status === 'saving' ? '保存中' : '保存并生效'}
          </ActionButton>
          <ActionButton icon={RefreshCw} variant="secondary" onClick={() => window.location.reload()}>重新检测连接</ActionButton>
        </footer>
      </div>
    </div>
  );
}
