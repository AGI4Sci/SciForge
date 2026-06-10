import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
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
  SUPPORTED_LOCALES,
  localeText,
  normalizeLocale,
  type SupportedLocale,
} from '../../i18n';
import {
  secretInputPlaceholder,
  secretPresenceLabel,
  settingsSaveStateText,
  type ConfigSaveState,
} from './settingsModels';
import {
  publicConfigInputPlaceholder,
  publicConfigPresenceLabel,
  sanitizePublicTextRequired,
} from '../../publicProjectionSanitizer';
import {
  settingsSectionLabel,
  settingsSectionNavItemsForLocale,
  type SettingsSectionId,
} from './settingsPageModel';
import { SettingsArchivedChatsPanel } from './SettingsArchivedChatsPanel';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';

export function SettingsPage({
  config,
  onChange,
  saveState,
  onSave,
  onBack,
  initialSection = 'general',
  archivedSessions = [],
  scenarioLabelFor,
  onRestoreArchivedSession,
  onDeleteArchivedSessions,
  onClearArchivedSessions,
}: {
  config: SciForgeConfig;
  onChange: (patch: Partial<SciForgeConfig>) => void;
  saveState: ConfigSaveState;
  onSave: () => void;
  onBack: () => void;
  initialSection?: SettingsSectionId;
  archivedSessions?: SciForgeSession[];
  scenarioLabelFor?: (scenarioId: ScenarioInstanceId) => string;
  onRestoreArchivedSession?: (scenarioId: ScenarioInstanceId, sessionId: string) => void;
  onDeleteArchivedSessions?: (scenarioId: ScenarioInstanceId, sessionIds: string[]) => void;
  onClearArchivedSessions?: () => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const locale = normalizeLocale(config.locale);
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale, copy);
  const settingsNavItems = settingsSectionNavItemsForLocale(locale);
  const activeNavItem = settingsNavItems.find((item) => item.id === activeSection);
  const healthItems = useRuntimeHealth(config);
  const peerInstances = config.peerInstances ?? [];
  const peerValidationErrors = validatePeerInstances(peerInstances);

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
    <div className="settings-page" aria-label={t({ 'zh-CN': 'SciForge 设置', 'en-US': 'SciForge settings' })}>
      <nav className="settings-page-nav" aria-label={t({ 'zh-CN': '设置分类', 'en-US': 'Settings sections' })}>
        <button type="button" className="settings-page-back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden />
          {t({ 'zh-CN': '返回应用', 'en-US': 'Back to app' })}
        </button>
        <ul className="settings-page-nav-list">
          {settingsNavItems.map((item) => {
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
          <h1>{settingsSectionLabel(activeSection, locale)}</h1>
          <p>{activeNavItem?.description}</p>
        </header>
        <div className="settings-page-body">
          {activeSection === 'general' ? (
            <div className="settings-grid">
              <label>
                <span>{t({ 'zh-CN': '超时时间 ms', 'en-US': 'Timeout ms' })}</span>
                <input
                  type="number"
                  min={30000}
                  step={10000}
                  value={config.requestTimeoutMs}
                  onChange={(event) => onChange({ requestTimeoutMs: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>{t({ 'zh-CN': '最大上下文窗口（k tokens）', 'en-US': 'Max context window (k tokens)' })}</span>
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
                <span>{t({ 'zh-CN': '默认允许全局视觉/截图取证使用共享系统鼠标/键盘', 'en-US': 'Allow global vision screenshot evidence to use shared system mouse and keyboard by default' })}</span>
              </label>
            </div>
          ) : null}
          {activeSection === 'appearance' ? (
            <div className="settings-grid">
              <label>
                <span>{t({ 'zh-CN': '界面主题', 'en-US': 'Interface theme' })}</span>
                <select value={config.theme ?? 'dark'} onChange={(event) => onChange({ theme: event.target.value === 'light' ? 'light' : 'dark' })}>
                  <option value="dark">{t({ 'zh-CN': '深色', 'en-US': 'Dark' })}</option>
                  <option value="light">{t({ 'zh-CN': '浅色', 'en-US': 'Light' })}</option>
                </select>
              </label>
              <label>
                <span>{t({ 'zh-CN': '应用语言', 'en-US': 'App language' })}</span>
                <select value={locale} onChange={(event) => onChange({ locale: normalizeLocale(event.target.value) })}>
                  {SUPPORTED_LOCALES.map((item) => (
                    <option key={item.id} value={item.id}>{item.nativeLabel}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          {activeSection === 'workspace' ? (
            <div className="settings-grid">
              <label>
                <span>Workspace Writer URL</span>
                <input
                  defaultValue=""
                  onChange={(event) => onChange({ workspaceWriterBaseUrl: event.target.value })}
                  placeholder={publicConfigInputPlaceholder(config.workspaceWriterBaseUrl, 'Enter Workspace Writer URL')}
                  aria-describedby="settings-workspace-writer-status"
                />
                <small id="settings-workspace-writer-status">{publicConfigPresenceLabel(config.workspaceWriterBaseUrl, 'Workspace Writer URL')}</small>
              </label>
              <label className="wide">
                <span>Workspace Path</span>
                <input
                  defaultValue=""
                  onChange={(event) => onChange({ workspacePath: event.target.value })}
                  placeholder={publicConfigInputPlaceholder(config.workspacePath, 'Choose or enter a workspace path')}
                  aria-describedby="settings-workspace-path-status"
                />
                <small id="settings-workspace-path-status">{publicConfigPresenceLabel(config.workspacePath, 'Workspace path')}</small>
              </label>
              <div className="wide settings-peer-section">
                <div className="settings-peer-section-head">
                  <span>Peer Instances</span>
                  <ActionButton icon={Plus} variant="secondary" onClick={addPeerInstance}>
                    {t({ 'zh-CN': '新增 Peer', 'en-US': 'Add peer' })}
                  </ActionButton>
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
                          <span>{peer.enabled ? t({ 'zh-CN': '启用', 'en-US': 'Enabled' }) : t({ 'zh-CN': '禁用', 'en-US': 'Disabled' })}</span>
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
                          <input
                            defaultValue=""
                            onChange={(event) => updatePeerInstance(index, { appUrl: event.target.value })}
                            placeholder={publicConfigInputPlaceholder(peer.appUrl, 'Enter peer app URL')}
                            aria-label={`${peer.name || 'Peer'} app URL`}
                          />
                        </label>
                        <label>
                          <span>Workspace Writer URL</span>
                          <input
                            defaultValue=""
                            onChange={(event) => updatePeerInstance(index, { workspaceWriterUrl: event.target.value })}
                            placeholder={publicConfigInputPlaceholder(peer.workspaceWriterUrl, 'Enter peer writer URL')}
                            aria-label={`${peer.name || 'Peer'} writer URL`}
                          />
                        </label>
                        <label className="settings-peer-path">
                          <span>Workspace Path</span>
                          <input
                            defaultValue=""
                            onChange={(event) => updatePeerInstance(index, { workspacePath: event.target.value })}
                            placeholder={publicConfigInputPlaceholder(peer.workspacePath, 'Enter peer workspace path')}
                            aria-label={`${peer.name || 'Peer'} workspace path`}
                          />
                        </label>
                        <ActionButton icon={Trash2} variant="secondary" onClick={() => removePeerInstance(index)}>
                          {t({ 'zh-CN': '删除', 'en-US': 'Delete' })}
                        </ActionButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="settings-peer-empty">{t({ 'zh-CN': '尚未配置 peer 实例。', 'en-US': 'No peer instances configured.' })}</p>
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
                  <span>{t({ 'zh-CN': 'Runtime Provider', 'en-US': 'Runtime Provider' })}</span>
                  <code>{t({ 'zh-CN': 'Model Router', 'en-US': 'Model Router' })}</code>
                </div>
                <p className="settings-peer-empty">
                  {t({
                    'zh-CN': '主对话和 repair 流程使用 Codex app-server，并通过 Model Router profile 调用模型。config.local.json 中的 API key 只作为 Router 成员模型配置，不会从 UI 直连 provider。',
                    'en-US': 'Main chat and repair flows use Codex app-server and call models through a Model Router profile. API keys in config.local.json are Router member-model config only and are not sent from this UI to providers.',
                  })}
                </p>
              </div>
              <label>
                <span>Runtime Adapter</span>
                <select value="codex" disabled>
                  <option value="codex">Codex app-server</option>
                </select>
              </label>
              <label>
                <span>Runtime Profile</span>
                <input
                  defaultValue=""
                  onChange={(event) => onChange({ runtimeProfile: event.target.value })}
                  placeholder={publicConfigInputPlaceholder(config.runtimeProfile, 'Enter runtime profile alias')}
                  aria-describedby="settings-runtime-profile-status"
                />
                <small id="settings-runtime-profile-status">{publicConfigPresenceLabel(config.runtimeProfile, 'Runtime profile')}</small>
              </label>
              <label>
                <span>Model Router Provider</span>
                <select value="sciforge-model-router" disabled>
                  <option value="sciforge-model-router">sciforge-model-router</option>
                </select>
              </label>
              <div className="wide settings-peer-section" aria-label="Router member model settings">
                <div className="settings-peer-section-head">
                  <span>Router Member Model</span>
                  <code>config.local.json llm</code>
                </div>
                <p className="settings-peer-empty">
                  {t({
                    'zh-CN': '这些字段会写入本地 config.local.json 的 llm 配置，供 Model Router 调用成员模型；Runtime Codex 仍只请求公开 Router profile。',
                    'en-US': 'These fields are written to the local config.local.json llm config for Model Router member-model calls; Runtime Codex still requests only the public Router profile.',
                  })}
                </p>
              </div>
              <label>
                <span>Member Provider</span>
                <input
                  defaultValue=""
                  onChange={(event) => onChange({ modelProvider: event.target.value })}
                  placeholder={publicConfigInputPlaceholder(config.modelProvider, 'openai-compatible')}
                  aria-describedby="settings-member-provider-status"
                />
                <small id="settings-member-provider-status">{publicConfigPresenceLabel(config.modelProvider, 'Member provider')}</small>
              </label>
              <label>
                <span>Member Base URL</span>
                <input
                  defaultValue=""
                  onChange={(event) => onChange({ modelBaseUrl: event.target.value })}
                  placeholder={publicConfigInputPlaceholder(config.modelBaseUrl, 'https://provider.example/v1')}
                  aria-describedby="settings-member-base-url-status"
                />
                <small id="settings-member-base-url-status">{publicConfigPresenceLabel(config.modelBaseUrl, 'Member base URL')}</small>
              </label>
              <label>
                <span>Member Model</span>
                <input
                  defaultValue=""
                  onChange={(event) => onChange({ modelName: event.target.value })}
                  placeholder={publicConfigInputPlaceholder(config.modelName, 'provider/model-name')}
                  aria-describedby="settings-model-status"
                />
                <small id="settings-model-status">{publicConfigPresenceLabel(config.modelName, 'Member model')}</small>
              </label>
              <label>
                <span>Member API Key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value=""
                  onChange={(event) => onChange({ apiKey: event.target.value })}
                  placeholder={secretInputPlaceholder(config.apiKey, 'sk-...', locale)}
                  aria-describedby="settings-member-api-key-status"
                />
                <small id="settings-member-api-key-status">{secretPresenceLabel(config.apiKey, 'Member API key', locale)}</small>
              </label>
            </div>
          ) : null}
          {activeSection === 'connections' ? (
            <div className="settings-grid">
              <label className="wide">
                <span>Codex Runtime Connection URL</span>
                <input
                  defaultValue=""
                  onChange={(event) => onChange({ agentServerBaseUrl: event.target.value })}
                  placeholder={publicConfigInputPlaceholder(config.agentServerBaseUrl, 'Enter Runtime connection URL')}
                  aria-describedby="settings-runtime-url-status"
                />
                <small id="settings-runtime-url-status">{publicConfigPresenceLabel(config.agentServerBaseUrl, 'Runtime connection URL')}</small>
              </label>
              <div className="wide">
                <RuntimeHealthPanel items={healthItems} />
              </div>
            </div>
          ) : null}
          {activeSection === 'archived' ? (
            <SettingsArchivedChatsPanel
              archivedSessions={archivedSessions}
              scenarioLabelFor={(scenarioId) => scenarioLabelFor?.(scenarioId) ?? scenarioId}
              onRestore={(scenarioId, sessionId) => onRestoreArchivedSession?.(scenarioId, sessionId)}
              onDelete={(scenarioId, sessionIds) => onDeleteArchivedSessions?.(scenarioId, sessionIds)}
              onClearAll={() => onClearArchivedSessions?.()}
            />
          ) : null}
          {activeSection === 'feedback' ? (
            <div className="settings-grid">
              <label className="wide">
                <span>Feedback GitHub repository</span>
                <input
                  value={config.feedbackGithubRepo ?? ''}
                  onChange={(event) => onChange({ feedbackGithubRepo: event.target.value.trim() || undefined })}
                  placeholder={t({ 'zh-CN': '默认 AGI4Sci/SciForge、fork 或完整 GitHub URL', 'en-US': 'Default AGI4Sci/SciForge, fork, or full GitHub URL' })}
                />
              </label>
              <label className="wide">
                <span>Feedback GitHub token (optional)</span>
                <input
                  type="password"
                  autoComplete="off"
                  value=""
                  onChange={(event) => onChange({ feedbackGithubToken: event.target.value.trim() || undefined })}
                  placeholder={secretInputPlaceholder(
                    config.feedbackGithubToken,
                    t({
                      'zh-CN': 'classic 或 fine-grained PAT，需要 Issues 权限，本地存储',
                      'en-US': 'classic or fine-grained PAT with Issues access, stored locally',
                    }),
                    locale,
                  )}
                  aria-describedby="settings-feedback-github-token-status"
                />
                <small id="settings-feedback-github-token-status">{secretPresenceLabel(config.feedbackGithubToken, 'GitHub token', locale)}</small>
              </label>
              <label className="wide">
                <span>Feedback GitHub labels</span>
                <input
                  value={(config.feedbackGithubLabels ?? []).join(', ')}
                  onChange={(event) => onChange({ feedbackGithubLabels: event.target.value.split(',').map((label) => label.trim()).filter(Boolean) })}
                  placeholder="feedback, sciforge-inbox"
                />
              </label>
              <label className="wide">
                <span>Feedback GitHub assignees</span>
                <input
                  value={(config.feedbackGithubAssignees ?? []).join(', ')}
                  onChange={(event) => onChange({ feedbackGithubAssignees: event.target.value.split(',').map((login) => login.trim()).filter(Boolean) })}
                  placeholder="github-login-1, github-login-2"
                />
              </label>
              <label>
                <span>Feedback GitHub milestone</span>
                <input
                  value={config.feedbackGithubMilestone ?? ''}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    const numeric = Number(value);
                    onChange({ feedbackGithubMilestone: value && Number.isFinite(numeric) ? numeric : value || undefined });
                  }}
                  placeholder="number or title"
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
            {settingsSaveStateText(saveState, locale)}
            {' '}
            {t({ 'zh-CN': '下一次 Codex Runtime 请求会使用：', 'en-US': 'Next Codex Runtime request will use:' })}
            {' '}
            <code>{config.runtimeProfile?.trim() ? t({ 'zh-CN': 'Runtime profile 已配置（已隐藏）', 'en-US': 'Runtime profile configured (masked)' }) : t({ 'zh-CN': 'Runtime profile 未配置', 'en-US': 'Runtime profile missing' })}</code>
            <strong>{publicModelProviderLabel(config.modelProvider)}</strong>
            {config.modelName.trim() ? <em>{t({ 'zh-CN': 'Model 已配置（已隐藏）', 'en-US': 'Model configured (masked)' })}</em> : <em>{t({ 'zh-CN': '用户模型未设置', 'en-US': 'user model not set' })}</em>}
          </span>
          <ActionButton icon={Save} variant="primary" onClick={onSave} disabled={saveState.status === 'saving' || peerValidationErrors.length > 0}>
            {saveState.status === 'saving' ? t({ 'zh-CN': '保存中', 'en-US': 'Saving' }) : t({ 'zh-CN': '保存', 'en-US': 'Save' })}
          </ActionButton>
          <ActionButton icon={RefreshCw} variant="secondary" onClick={() => window.location.reload()}>
            {t({ 'zh-CN': '重新检测连接', 'en-US': 'Recheck connection' })}
          </ActionButton>
        </footer>
      </div>
    </div>
  );
}

function publicModelProviderLabel(value: string) {
  const provider = sanitizePublicTextRequired(value || 'native', 'model provider');
  if (provider === 'native') return 'native';
  if (provider === 'openai-compatible') return 'openai-compatible';
  if (provider === 'openrouter') return 'openrouter';
  if (provider === 'codex-chatgpt') return 'codex-chatgpt';
  if (provider === 'gemini') return 'gemini';
  return 'model provider configured (masked)';
}
