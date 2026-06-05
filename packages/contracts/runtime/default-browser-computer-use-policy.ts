export const HARD_CONFIRM_CATEGORIES = [
  'payments-transfers-purchases',
  'external-communications',
  'external-system-submission',
  'remote-delete-overwrite-archive',
  'external-upload',
  'account-security-privacy-billing',
  'legal-compliance-contracts',
  'external-system-execution',
] as const;

export type HardConfirmCategory = (typeof HARD_CONFIRM_CATEGORIES)[number];

export const AUTONOMY_PROFILE_IDS = [
  'assisted-autonomy',
  'high-autonomy',
  'research-sandbox-max',
] as const;

export type AuthorizationProfileId = (typeof AUTONOMY_PROFILE_IDS)[number];

export interface AuthorizationProfile {
  schemaVersion: 'sciforge.authorization-profile.v1';
  id: AuthorizationProfileId;
  publicLabel: string;
  scope: {
    user: 'current-user';
    workspace: 'current-workspace';
  };
  defaultAutoScope: string[];
  hardConfirmCategories: HardConfirmCategory[];
  blockedCategories: string[];
}

export interface BrowserEvidenceDecisionInput {
  prompt: string;
  selectedToolIds?: string[];
  selectedSkillIds?: string[];
  availableSkills?: string[];
}

export type BrowserEvidenceDecision =
  | { decision: 'search'; reason: 'explicit-browser-search' | 'url-or-browser-ref-request' | 'current-external-or-citation-request'; query: string }
  | { decision: 'skip'; reason: 'local-only-or-no-network' | 'no-browser-evidence-needed' | 'empty-query' };

export type ComputerUseRiskDecision = 'auto' | 'needs-confirmation' | 'blocked';

export interface ComputerUseRiskClassification {
  decision: ComputerUseRiskDecision;
  category: string;
  hardConfirm: boolean;
  reason: string;
}

export type RuntimeReadinessValue = 'ready' | 'blocked' | 'unavailable' | 'unknown' | 'missing';

export interface ComputerUsePreflightInput {
  intent: string;
  target?: {
    bound?: boolean;
    summary?: string;
    refs?: string[];
  };
  readiness: {
    browserHostSession?: RuntimeReadinessValue;
    nativeBridge?: RuntimeReadinessValue;
    nativeSurface?: RuntimeReadinessValue;
    windowActionSession?: RuntimeReadinessValue;
    computerUseAdapter?: RuntimeReadinessValue;
  };
  observation?: {
    fresh?: boolean;
    refs?: string[];
  };
  permissions?: {
    refs?: string[];
    stopCancelPath?: boolean;
  };
  authorizationProfile?: AuthorizationProfile;
}

export interface ComputerUsePreflightBlocker {
  reason:
    | 'native-bridge-unavailable'
    | 'browser-host-session-unavailable'
    | 'native-surface-unavailable'
    | 'window-action-session-unavailable'
    | 'computer-use-adapter-unavailable'
    | 'target-unbound'
    | 'needs-observation'
    | 'permission-missing'
    | 'cancel-path-missing'
    | 'policy-blocked';
  recovery: string;
}

export interface ComputerUsePreflightResult {
  schemaVersion: 'sciforge.computer-use.preflight.v1';
  status: 'ready' | 'needs-confirmation' | 'blocked';
  authorizationProfile: AuthorizationProfile;
  target: {
    summary: string;
    refs: string[];
  };
  readiness: ComputerUsePreflightInput['readiness'];
  evidenceRefs: string[];
  risk: ComputerUseRiskClassification;
  blockers: ComputerUsePreflightBlocker[];
  confirmation?: {
    action: string;
    target: string;
    impact: string;
    evidenceRefs: string[];
    authorizationProfile: AuthorizationProfile;
    controls: ['Confirm', 'Cancel'];
  };
}

export interface CapabilityAnswerProjectionInput {
  capability: 'browser' | 'computer-use';
  readiness: ComputerUsePreflightInput['readiness'];
  refs?: string[];
}

export interface CapabilityAnswerProjection {
  schemaVersion: 'sciforge.capability-answer-projection.v1';
  capability: CapabilityAnswerProjectionInput['capability'];
  productCapability: 'supported';
  runtimeReadiness: 'ready' | 'blocked';
  blockers: ComputerUsePreflightBlocker['reason'][];
  refs: string[];
  nextAction: string;
  answerSummary: string;
}

export type DefaultCapabilityQuestion = 'browser' | 'computer-use';

export const RUNTIME_GUI_COMPONENT_ID = 'runtime-gui' as const;

const AUTHORIZATION_PROFILES: Record<AuthorizationProfileId, AuthorizationProfile> = {
  'assisted-autonomy': {
    schemaVersion: 'sciforge.authorization-profile.v1',
    id: 'assisted-autonomy',
    publicLabel: 'Assisted Autonomy',
    scope: { user: 'current-user', workspace: 'current-workspace' },
    defaultAutoScope: ['observe', 'search', 'open-public-page', 'low-risk-navigation', 'draft-only'],
    hardConfirmCategories: [...HARD_CONFIRM_CATEGORIES],
    blockedCategories: ['security-boundary-bypass', 'platform-abuse', 'unclear-sensitive-transfer'],
  },
  'high-autonomy': {
    schemaVersion: 'sciforge.authorization-profile.v1',
    id: 'high-autonomy',
    publicLabel: 'High Autonomy',
    scope: { user: 'current-user', workspace: 'current-workspace' },
    defaultAutoScope: ['observe', 'search', 'navigate', 'filter', 'paginate', 'non-submit-click', 'public-download', 'local-workspace-edit', 'draft-only'],
    hardConfirmCategories: [...HARD_CONFIRM_CATEGORIES],
    blockedCategories: ['security-boundary-bypass', 'platform-abuse', 'unclear-sensitive-transfer'],
  },
  'research-sandbox-max': {
    schemaVersion: 'sciforge.authorization-profile.v1',
    id: 'research-sandbox-max',
    publicLabel: 'Research Sandbox Max',
    scope: { user: 'current-user', workspace: 'current-workspace' },
    defaultAutoScope: ['observe', 'search', 'sandbox-navigation', 'virtual-screen', 'local-workspace-edit', 'test-account-draft'],
    hardConfirmCategories: [...HARD_CONFIRM_CATEGORIES],
    blockedCategories: ['security-boundary-bypass', 'platform-abuse', 'unclear-sensitive-transfer'],
  },
};

export function authorizationProfile(profileId: unknown): AuthorizationProfile | undefined {
  if (typeof profileId !== 'string') return undefined;
  return AUTHORIZATION_PROFILES[profileId as AuthorizationProfileId];
}

export function defaultAuthorizationProfile(): AuthorizationProfile {
  return AUTHORIZATION_PROFILES['high-autonomy'];
}

export function authorizationProfileOrDefault(profileId: unknown): {
  profile: AuthorizationProfile;
  source: 'declared' | 'default' | 'declared-invalid-profile';
} {
  if (profileId === undefined || profileId === null || profileId === '') {
    return { profile: defaultAuthorizationProfile(), source: 'default' };
  }
  const profile = authorizationProfile(profileId);
  if (profile) return { profile, source: 'declared' };
  return { profile: defaultAuthorizationProfile(), source: 'declared-invalid-profile' };
}

export function evaluateBrowserEvidenceNeed(input: BrowserEvidenceDecisionInput): BrowserEvidenceDecision {
  const prompt = compactText(input.prompt, 600);
  if (!prompt) return { decision: 'skip', reason: 'empty-query' };
  if (forbidsNetwork(prompt)) return { decision: 'skip', reason: 'local-only-or-no-network' };
  if (localRefsOnly(prompt)) return { decision: 'skip', reason: 'local-only-or-no-network' };

  const selected = [
    ...(input.selectedToolIds ?? []),
    ...(input.selectedSkillIds ?? []),
    ...(input.availableSkills ?? []),
  ].join(' ');
  const combined = `${prompt}\n${selected}`;
  if (explicitBrowserSearch(combined)) {
    const query = browserSearchQueryFromText(prompt) ?? prompt;
    return { decision: 'search', reason: 'explicit-browser-search', query };
  }

  const url = firstPublicHttpUrl(prompt);
  if (url || browserRefRequest(combined)) {
    return { decision: 'search', reason: 'url-or-browser-ref-request', query: url ?? prompt };
  }

  if (currentExternalOrCitationRequest(prompt)) {
    return { decision: 'search', reason: 'current-external-or-citation-request', query: prompt };
  }
  return { decision: 'skip', reason: 'no-browser-evidence-needed' };
}

export function browserSearchEngineFromPrompt(prompt: string): 'bing' | 'duckduckgo' {
  return /duckduckgo|ddg/i.test(prompt) ? 'duckduckgo' : 'bing';
}

export function browserSearchLimitFromPrompt(prompt: string): number {
  const match = /(?:limit|maxResults|max results|前)\s*[:=]?\s*(\d{1,2})/i.exec(prompt);
  if (!match) return 5;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(parsed, 1), 10);
}

export function classifyComputerUseRisk(input: {
  action: string;
  authorizationProfile?: AuthorizationProfile;
}): ComputerUseRiskClassification {
  const text = normalizeRiskText(input.action);
  if (matchesAny(text, [
    /\b(?:bypass|circumvent|solve|defeat)\b.*\b(?:captcha|2fa|mfa|login\s+risk|access\s+control|security\s+barrier)\b/,
    /\b(?:identity\s+spoof|impersonat|pretend\s+to\s+be|冒充|绕过.*(?:验证码|风控|访问控制|安全屏障))\b/,
    /\b(?:bulk|mass|大量|批量)\b.*\b(?:account|registration|signup|delete|deletion|remove|账号|注册|删除)\b/,
    /\b(?:unclear|unknown|不明确)\b.*\b(?:sensitive|secret|credential|private|敏感|凭证)\b.*\b(?:transfer|upload|send|传输|上传|发送)\b/,
  ])) {
    return {
      decision: 'blocked',
      category: 'security-boundary-bypass',
      hardConfirm: false,
      reason: 'security, access-control, or platform-abuse bypass is blocked by default',
    };
  }

  const hardConfirm = hardConfirmCategoryForText(text);
  if (hardConfirm) {
    return {
      decision: 'needs-confirmation',
      category: hardConfirm,
      hardConfirm: true,
      reason: hardConfirmReason(hardConfirm),
    };
  }

  return {
    decision: 'auto',
    category: 'ordinary-navigation',
    hardConfirm: false,
    reason: 'ordinary low-risk observation or navigation is allowed by the selected autonomy profile',
  };
}

export function evaluateComputerUsePreflight(input: ComputerUsePreflightInput): ComputerUsePreflightResult {
  const authorization = input.authorizationProfile ?? authorizationProfileOrDefault(undefined).profile;
  const targetRefs = boundedRefs(input.target?.refs ?? []);
  const observationRefs = boundedRefs(input.observation?.refs ?? []);
  const permissionRefs = boundedRefs(input.permissions?.refs ?? []);
  const evidenceRefs = boundedRefs([...observationRefs, ...permissionRefs]);
  const targetSummary = compactText(input.target?.summary ?? 'Unbound target', 120);
  const blockers = [
    ...readinessBlockers(input.readiness),
    ...(input.target?.bound === true ? [] : [blocker('target-unbound')]),
    ...(input.observation?.fresh === true && observationRefs.length ? [] : [blocker('needs-observation')]),
    ...(permissionRefs.length ? [] : [blocker('permission-missing')]),
    ...(input.permissions?.stopCancelPath === true ? [] : [blocker('cancel-path-missing')]),
  ];
  const risk = classifyComputerUseRisk({ action: input.intent, authorizationProfile: authorization });
  if (risk.decision === 'blocked') blockers.push(blocker('policy-blocked'));
  const status = blockers.length
    ? 'blocked'
    : risk.decision === 'needs-confirmation'
      ? 'needs-confirmation'
      : 'ready';
  return {
    schemaVersion: 'sciforge.computer-use.preflight.v1',
    status,
    authorizationProfile: authorization,
    target: {
      summary: targetSummary,
      refs: targetRefs,
    },
    readiness: input.readiness,
    evidenceRefs,
    risk,
    blockers,
    ...(status === 'needs-confirmation' ? {
      confirmation: {
        action: compactText(input.intent, 160),
        target: targetSummary,
        impact: risk.reason,
        evidenceRefs,
        authorizationProfile: authorization,
        controls: ['Confirm', 'Cancel'],
      },
    } : {}),
  };
}

export function capabilityAnswerProjection(input: CapabilityAnswerProjectionInput): CapabilityAnswerProjection {
  const blockers = readinessBlockers(input.readiness).map((item) => item.reason);
  const runtimeReadiness = blockers.length ? 'blocked' : 'ready';
  const capabilityName = input.capability === 'computer-use' ? 'Computer Use' : 'Browser';
  const nextAction = runtimeReadiness === 'ready'
    ? `${capabilityName} is ready; proceed through Agent Host preflight with refs-first evidence.`
    : `Open the Desktop native runtime or repair the blocked capability refs before using ${capabilityName}.`;
  return {
    schemaVersion: 'sciforge.capability-answer-projection.v1',
    capability: input.capability,
    productCapability: 'supported',
    runtimeReadiness,
    blockers,
    refs: boundedRefs(input.refs ?? []),
    nextAction,
    answerSummary: `${capabilityName} product capability is supported; current runtime readiness is ${runtimeReadiness}${blockers.length ? ` (${blockers.join(', ')})` : ''}. ${nextAction}`,
  };
}

export function defaultGuiOperationIntent(input: BrowserEvidenceDecisionInput): boolean {
  const prompt = compactText(input.prompt, 600);
  if (/^\s*\/(?:computer-use|browser)\b/i.test(prompt)) return false;
  if (hardConfirmCategoryForText(normalizeRiskText(prompt))) return true;
  if (evaluateBrowserEvidenceNeed(input).decision === 'search') return false;
  return /\b(?:click|double[-\s]?click|type|fill|scroll|select|open\s+(?:the\s+)?(?:app|window|menu)|press|drag|operate|control|gui|screen|window|button|field|page|点击|输入|填写|滚动|选择|打开窗口|操作|按钮|页面)\b/i.test(prompt);
}

export function requiresComputerUseProductCompletionEvidence(input: {
  commandText: string;
  message?: string;
  claimType?: string;
  claimTexts?: string[];
  executionUnitTexts?: string[];
}): boolean {
  const claimText = [
    input.commandText,
    input.message,
    input.claimType,
    ...(input.claimTexts ?? []),
    ...(input.executionUnitTexts ?? []),
  ].filter((item): item is string => Boolean(item)).join(' ');
  const normalized = claimText.toLowerCase();
  const completionClaim = /\b(?:product[-\s]?completion|workflow\s+(?:complete|completed|completion)|artifact\s+(?:complete|completed|completion|workflow)|final\s+artifact|final\s+report|multi[-\s]?step.*completion|user[-\s]?level.*completion)\b/i.test(claimText)
    || /(?:工作流|流程|产物|最终产物|报告产物|最终报告|多步骤|用户级).{0,24}(?:完成|已完成|保存|预览|交付)|(?:完成|保存|预览|交付).{0,24}(?:工作流|流程|产物|最终产物|报告产物|最终报告)/i.test(claimText);
  const guiActionCount = [
    /\bclick\b/i,
    /\btype\b/i,
    /\bpress\b/i,
    /\bsave\b/i,
    /\bopen\b/i,
    /\bpreview\b/i,
    /\bwriter\b/i,
    /\bwindow\b/i,
    /点击/,
    /输入/,
    /保存/,
    /打开/,
    /预览/,
    /窗口/,
  ].filter((pattern) => pattern.test(input.commandText)).length;
  const workflowIntent = guiActionCount >= 3
    && (/\b(?:workflow|writer|preview|save|file|document|artifact|summary|report|complete|completion|final)\b/i.test(input.commandText)
      || /(?:工作流|流程|预览|保存|文件|文档|产物|报告|总结|摘要|完成|最终)/i.test(input.commandText));
  return completionClaim || (workflowIntent && (/\b(?:complete|completed|completion|workflow|preview|final|artifact|report)\b/i.test(normalized)
    || /(?:完成|工作流|流程|预览|最终|产物|报告)/i.test(input.commandText)));
}

export function hasCurrentRunComputerUseCompletionEvidenceRefs(refs: string[]): boolean {
  const accepted = refs.map((ref) => ref.trim()).filter(safeCurrentRunComputerUseCompletionEvidenceRef);
  const acceptanceDirs = accepted
    .map((ref) => currentRunDirForLeaf(ref, 'cu-user-acceptance-manifest.json'))
    .filter((ref): ref is string => Boolean(ref));
  const completionDirs = accepted
    .map((ref) => currentRunDirForLeaf(ref, 'isolated-desktop-l3-workflow-evidence.json'))
    .filter((ref): ref is string => Boolean(ref));
  if (!acceptanceDirs.length || !completionDirs.length) return false;
  return acceptanceDirs.some((dir) =>
    completionDirs.includes(dir)
    && accepted.some((ref) =>
      ref === `${dir}/current-run.json`
      || ref === `${dir}/current-run-pointer.json`
      || /\/current-run(?:-pointer)?\.json$/u.test(ref) && ref.startsWith(`${dir}/`),
    ),
  );
}

export function defaultCapabilityQuestion(prompt: string): DefaultCapabilityQuestion | undefined {
  if (/\b(?:do\s+you\s+have|can\s+you\s+use|are\s+you\s+able\s+to|support)\b.{0,80}\b(?:computer\s+use|desktop\s+control|gui\s+control)\b/i.test(prompt)
    || /(?:你|SciForge|assistant).{0,20}(?:有|能|可以).{0,30}(?:computer use|电脑操作|桌面操作|GUI 操作|控制屏幕|操作界面)/i.test(prompt)) {
    return 'computer-use';
  }
  if (/\b(?:do\s+you\s+have|can\s+you\s+use|are\s+you\s+able\s+to|support)\b.{0,80}\b(?:browser|web\s+search|browser\s+search)\b/i.test(prompt)
    || /(?:你|SciForge|assistant).{0,20}(?:有|能|可以).{0,30}(?:浏览器|网页搜索|Browser)/i.test(prompt)) {
    return 'browser';
  }
  return undefined;
}

function safeCurrentRunComputerUseCompletionEvidenceRef(ref: string): boolean {
  if (!ref || ref.length > 240) return false;
  if (/^(?:gui(?:\.|:)|ui:|fixture:|replay:)/i.test(ref)) return false;
  if (/https?:\/\/|data:image|base64|<html|secret|token|password|api[-_]?key|bearer/i.test(ref)) return false;
  return /^\.sciforge\/vision-runs\/[A-Za-z0-9._/-]+$/u.test(ref) && !ref.includes('..');
}

function currentRunDirForLeaf(ref: string, leaf: string): string | undefined {
  return ref.endsWith(`/${leaf}`) ? ref.slice(0, -1 * (`/${leaf}`).length) : undefined;
}

function readinessBlockers(readiness: ComputerUsePreflightInput['readiness']): ComputerUsePreflightBlocker[] {
  return [
    readiness.browserHostSession === 'ready' ? undefined : blocker('browser-host-session-unavailable'),
    readiness.nativeBridge === 'ready' ? undefined : blocker('native-bridge-unavailable'),
    readiness.nativeSurface === 'ready' ? undefined : blocker('native-surface-unavailable'),
    readiness.windowActionSession === 'ready' ? undefined : blocker('window-action-session-unavailable'),
    readiness.computerUseAdapter === 'ready' ? undefined : blocker('computer-use-adapter-unavailable'),
  ].filter((value): value is ComputerUsePreflightBlocker => Boolean(value));
}

function blocker(reason: ComputerUsePreflightBlocker['reason']): ComputerUsePreflightBlocker {
  const recovery: Record<ComputerUsePreflightBlocker['reason'], string> = {
    'native-bridge-unavailable': 'Start or reconnect the Desktop native bridge, then retry the Agent Host preflight.',
    'browser-host-session-unavailable': 'Create or reconnect a BrowserHostSession before using Browser or Computer Use live actions.',
    'native-surface-unavailable': 'Use the Desktop native Browser surface; Vite/Web dev can only show blocked diagnostics.',
    'window-action-session-unavailable': 'Bind or create a WindowActionSession through the Agent Host adapter.',
    'computer-use-adapter-unavailable': 'Register a Computer Use host adapter before executing GUI actions.',
    'target-unbound': 'Select or bind a Browser session, app window, screen region, file, terminal, or workspace object.',
    'needs-observation': 'Capture a fresh observation ref before any mutating action.',
    'permission-missing': 'Collect a scoped permission ref for the current target and action.',
    'cancel-path-missing': 'Provide a stop, cancel, or take-over path before execution.',
    'policy-blocked': 'Explain the policy block and choose a safe alternative; do not provide bypass steps.',
  };
  return { reason, recovery: recovery[reason] };
}

function hardConfirmCategoryForText(text: string): HardConfirmCategory | undefined {
  if (matchesAny(text, [/\b(?:pay|payment|purchase|buy|subscribe|subscription|refund|withdraw|transfer|trade|trading|checkout|付款|支付|购买|订阅|退款|提现|转账|交易)\b/])) {
    return 'payments-transfers-purchases';
  }
  if (matchesAny(text, [/\b(?:send|email|message|comment|ticket|post|publish|reply|dm|slack|wechat|发送|邮件|消息|评论|工单|公开帖子|回复)\b/])) {
    return 'external-communications';
  }
  if (matchesAny(text, [/\b(?:submit|register|apply|appointment|book|booking|enroll|sign\s*up|报名|提交|注册|申请|预约)\b/])) {
    return 'external-system-submission';
  }
  if (matchesAny(text, [/\b(?:delete|remove|overwrite|replace|close|archive|destroy|删除|覆盖|关闭|归档)\b.*\b(?:remote|account|cloud|server|external|远端|账号|云|外部)?/])) {
    return 'remote-delete-overwrite-archive';
  }
  if (matchesAny(text, [/\b(?:upload|attach|share)\b.*\b(?:file|image|dataset|credential|report|local|文件|图片|数据集|凭证|报告|本地)\b/])) {
    return 'external-upload';
  }
  if (matchesAny(text, [/\b(?:account|security|privacy|billing|api\s*key|token|team\s*member|permission|role|password|账号|安全|隐私|账单|权限|密钥|令牌|成员)\b/])) {
    return 'account-security-privacy-billing';
  }
  if (matchesAny(text, [/\b(?:legal|compliance|contract|terms|sign|signature|authorize|授权|合规|合同|条款|签署|签名)\b/])) {
    return 'legal-compliance-contracts';
  }
  if (matchesAny(text, [
    /\b(?:deploy|ci\/cd|ci|cd|cloud\s+resource|database\s+migration|db\s+migration|terraform|kubernetes|部署|云资源|数据库迁移|发布)\b/,
    /\brelease\b.{0,32}\b(?:to|production|prod|external|server|cloud)\b/,
  ])) {
    return 'external-system-execution';
  }
  return undefined;
}

function hardConfirmReason(category: HardConfirmCategory) {
  const reasons: Record<HardConfirmCategory, string> = {
    'payments-transfers-purchases': 'payments, transfers, purchases, subscriptions, refunds, withdrawals, and trading require hard confirmation',
    'external-communications': 'external communications require hard confirmation',
    'external-system-submission': 'submitting forms that affect external systems requires hard confirmation',
    'remote-delete-overwrite-archive': 'remote delete, overwrite, close, or archive actions require hard confirmation',
    'external-upload': 'uploading local files or data to external services requires hard confirmation',
    'account-security-privacy-billing': 'account, security, privacy, billing, API key, token, team, or permission changes require hard confirmation',
    'legal-compliance-contracts': 'legal, compliance, contract, terms, authorization, or signing actions require hard confirmation',
    'external-system-execution': 'external system execution such as deploys, cloud resources, or database migrations requires hard confirmation',
  };
  return reasons[category];
}

function explicitBrowserSearch(text: string) {
  return /\bbrowser_search\b/i.test(text)
    || /\/browser\s+search\b/i.test(text)
    || (/\b(?:browser|rendered|浏览器)\b/i.test(text) && /\b(?:search|query|检索|搜索)\b/i.test(text))
    || /\bbrowser_runtime\b/i.test(text);
}

function browserRefRequest(text: string) {
  return /\b(?:browser\s+ref|browser\s+pane|BrowserHostSession|网页证据|浏览器引用)\b/i.test(text);
}

function currentExternalOrCitationRequest(text: string) {
  const asksForEvidence = /\b(?:cite|citation|source|sources|url|link|reference|verify|引用|来源|链接|验证)\b/i.test(text);
  const asksForCurrent = /\b(?:latest|today|recent|real[-\s]?time|up[-\s]?to[-\s]?date|pricing|price|schedule|law|regulation|docs?|paper|product|web|website|external|release|version|changelog|最新|实时|今天|网页|外部|来源|价格|法规|文档|论文|版本|发布)\b/i.test(text);
  return asksForEvidence || asksForCurrent;
}

function browserSearchQueryFromText(prompt: string): string | undefined {
  const patterns = [
    /browser_search\s*\(\s*(?:query\s*[:=]\s*)?["“']([^"”']+)["”']\s*\)/i,
    /\/browser\s+search\s+["“']([^"”']+)["”']/i,
    /(?:browser\s+search|search|query|搜索|检索)\s*[:：]\s*["“']?([^"”'\n。；;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    const value = match?.[1]?.trim();
    if (value) return compactText(value, 240);
  }
  if (/\bbrowser_search\b/i.test(prompt)) return compactText(prompt.replace(/\bbrowser_search\b/ig, '').replace(/["“”']/g, ' '), 240);
  return undefined;
}

function firstPublicHttpUrl(text: string) {
  const match = /\bhttps?:\/\/[^\s"'<>]+/i.exec(text);
  if (!match) return undefined;
  return match[0].replace(/[),.;]+$/, '');
}

function forbidsNetwork(text: string) {
  return /\b(?:do\s+not|don't|no|without|disable|avoid)\b.{0,32}\b(?:browse|browser|web|internet|network|online|search)\b/i.test(text)
    || /\b(?:local[-\s]?only|only\s+(?:local|workspace|provided)|use\s+only\s+(?:local|workspace|provided)|provided\s+refs\s+only)\b/i.test(text)
    || /(?:不要|禁止|不许).{0,12}(?:联网|浏览|搜索|上网)/.test(text)
    || /(?:只|仅).{0,12}(?:本地|当前工作区|已提供)/.test(text);
}

function localRefsOnly(text: string) {
  return /\b(?:current|existing|available|provided|visible)\b.{0,24}\b(?:refs?|references?|context|workspace|files?)\b.{0,24}\b(?:only|without\s+(?:web|network|search|browsing))\b/i.test(text)
    || /\b(?:use|summarize|answer\s+from)\b.{0,32}\b(?:current|existing|available|provided)\b.{0,16}\b(?:refs?|references?|context)\b/i.test(text)
    || /(?:当前|现有|已提供).{0,12}(?:refs?|引用|上下文).{0,12}(?:只|仅|即可)/i.test(text);
}

function normalizeRiskText(text: string) {
  return compactText(text, 600).toLowerCase();
}

function compactText(value: string, maxLength: number) {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function boundedRefs(refs: string[]) {
  return Array.from(new Set(refs.filter((ref) => typeof ref === 'string' && ref.trim()).map((ref) => ref.trim()))).slice(0, 16);
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}
