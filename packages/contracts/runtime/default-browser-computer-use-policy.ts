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
  | { decision: 'open'; reason: 'url-or-browser-ref-request'; url: string }
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
    scopedExecutorRefs?: string[];
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
    | 'scoped-executor-missing'
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
  guardRefs?: {
    observationRefs: string[];
    permissionRefs: string[];
    scopedExecutorRefs: string[];
  };
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

  const selected = [
    ...(input.selectedToolIds ?? []),
    ...(input.selectedSkillIds ?? []),
    ...(input.availableSkills ?? []),
  ].join(' ');
  const combined = `${prompt}\n${selected}`;
  const signals = browserEvidenceSemanticSignals(prompt, combined);
  if (signals.noNetworkConstraint || signals.localOnlyConstraint) return { decision: 'skip', reason: 'local-only-or-no-network' };

  if (signals.explicitBrowserSearch) {
    const query = semanticBrowserSearchQueryFromPrompt(prompt) ?? prompt;
    return { decision: 'search', reason: 'explicit-browser-search', query };
  }

  const url = firstPublicHttpUrl(prompt);
  if (url) {
    return { decision: 'open', reason: 'url-or-browser-ref-request', url };
  }

  if (signals.browserReferenceRequest) {
    return { decision: 'search', reason: 'url-or-browser-ref-request', query: prompt };
  }

  if (signals.currentExternalEvidenceNeeded) {
    const query = semanticBrowserSearchQueryFromPrompt(prompt) ?? prompt;
    return { decision: 'search', reason: 'current-external-or-citation-request', query };
  }
  return { decision: 'skip', reason: 'no-browser-evidence-needed' };
}

export function semanticBrowserSearchQueryFromPrompt(prompt: string): string | undefined {
  const explicitQuery = browserSearchQueryFromText(prompt);
  if (explicitQuery) return finalizeSemanticBrowserSearchQuery(explicitQuery);
  const url = firstPublicHttpUrl(prompt);
  if (url) return url;
  const topic = naturalLanguageSearchTopicFromPrompt(prompt);
  return topic ? finalizeSemanticBrowserSearchQuery(topic) : undefined;
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
  const authorization = input.authorizationProfile ?? defaultAuthorizationProfile();
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

  const sideEffect = computerUseSideEffectSignals(text);
  const hardConfirm = sideEffect.category;
  if (hardConfirm && authorization.blockedCategories.includes(hardConfirm)) {
    return {
      decision: 'blocked',
      category: hardConfirm,
      hardConfirm: false,
      reason: `${hardConfirm} is blocked by the selected autonomy profile`,
    };
  }
  if (hardConfirm && authorization.hardConfirmCategories.includes(hardConfirm)) {
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
  const scopedExecutorRefs = boundedRefs(input.permissions?.scopedExecutorRefs ?? []);
  const evidenceRefs = boundedRefs([...observationRefs, ...permissionRefs, ...scopedExecutorRefs]);
  const targetSummary = compactText(input.target?.summary ?? 'Unbound target', 120);
  const blockers = [
    ...readinessBlockers(input.readiness),
    ...(input.target?.bound === true ? [] : [blocker('target-unbound')]),
    ...(input.observation?.fresh === true && observationRefs.length ? [] : [blocker('needs-observation')]),
    ...(permissionRefs.length ? [] : [blocker('permission-missing')]),
    ...(scopedExecutorRefs.length ? [] : [blocker('scoped-executor-missing')]),
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
    guardRefs: {
      observationRefs,
      permissionRefs,
      scopedExecutorRefs,
    },
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
  if (evaluateBrowserEvidenceNeed(input).decision !== 'skip') return false;
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
    'scoped-executor-missing': 'Provide a scoped executor ref that binds the native input adapter to the current target before execution.',
    'cancel-path-missing': 'Provide a stop, cancel, or take-over path before execution.',
    'policy-blocked': 'Explain the policy block and choose a safe alternative; do not provide bypass steps.',
  };
  return { reason, recovery: recovery[reason] };
}

function hardConfirmCategoryForText(text: string): HardConfirmCategory | undefined {
  return computerUseSideEffectSignals(text).category;
}

function computerUseSideEffectSignals(text: string): { category?: HardConfirmCategory; signals: string[] } {
  const signals: string[] = [];
  let category: HardConfirmCategory | undefined;
  const choose = (next: HardConfirmCategory, signal: string) => {
    if (!category) category = next;
    signals.push(signal);
  };

  // Semantic safety principle: natural-language tokens below are only evidence
  // for a side-effect category. The final action decision is made by combining
  // the category with the selected authorization profile, never by a bare
  // keyword match alone.
  if (matchesAny(text, [/\b(?:pay|payment|purchase|buy|order|invoice|paid|subscribe|subscription|refund|withdraw|transfer|wire|trade|trading|checkout|付款|支付|购买|下单|订单|订阅|退款|提现|转账|交易)\b/])) {
    choose('payments-transfers-purchases', 'monetary-or-purchase-side-effect');
  }
  if (category) return { category, signals };

  if (matchesAny(text, [/\b(?:send|email|message|comment|ticket|post|publish|reply|dm|slack|wechat|发送|邮件|消息|评论|工单|公开帖子|回复)\b/])) {
    choose('external-communications', 'external-communication-side-effect');
  }
  if (category) return { category, signals };
  if (matchesAny(text, [/\b(?:submit|register|apply|appointment|book|booking|enroll|sign\s*up|报名|提交|注册|申请|预约)\b/])) {
    choose('external-system-submission', 'external-submission-side-effect');
  }
  if (category) return { category, signals };
  if (matchesAny(text, [/\b(?:delete|remove|overwrite|replace|close|archive|destroy|删除|覆盖|关闭|归档)\b.*\b(?:remote|account|cloud|server|external|远端|账号|云|外部)?/])) {
    choose('remote-delete-overwrite-archive', 'remote-destructive-side-effect');
  }
  if (category) return { category, signals };
  if (matchesAny(text, [/\b(?:upload|attach|share)\b.*\b(?:file|image|dataset|credential|report|local|文件|图片|数据集|凭证|报告|本地)\b/])) {
    choose('external-upload', 'external-upload-side-effect');
  }
  if (category) return { category, signals };
  if (matchesAny(text, [/\b(?:account|security|privacy|billing|api\s*key|token|team\s*member|permission|role|password|账号|安全|隐私|账单|权限|密钥|令牌|成员)\b/])) {
    choose('account-security-privacy-billing', 'account-security-privacy-billing-side-effect');
  }
  if (category) return { category, signals };
  if (matchesAny(text, [/\b(?:legal|compliance|contract|terms|sign|signature|authorize|授权|合规|合同|条款|签署|签名)\b/])) {
    choose('legal-compliance-contracts', 'legal-compliance-contract-side-effect');
  }
  if (category) return { category, signals };
  if (matchesAny(text, [
    /\b(?:deploy|ci\/cd|ci|cd|cloud\s+resource|database\s+migration|db\s+migration|terraform|kubernetes|部署|云资源|数据库迁移|发布)\b/,
    /\brelease\b.{0,32}\b(?:to|production|prod|external|server|cloud)\b/,
  ])) {
    choose('external-system-execution', 'external-system-execution-side-effect');
  }
  return { category, signals };
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

function browserEvidenceSemanticSignals(prompt: string, combined: string) {
  const noNetworkConstraint = forbidsNetwork(prompt);
  const localOnlyConstraint = localRefsOnly(prompt);
  const explicitBrowserSearchSignal = explicitBrowserSearch(combined);
  const browserReferenceSignal = browserRefRequest(combined);
  const currentExternalSignal = currentExternalOrCitationRequest(prompt);
  const lookupIntentSignal = externalLookupIntent(prompt);
  const publicTopicSignal = publicExternalTopicSignal(prompt);

  // Semantic routing principle: regex/keyword checks above are bounded feature
  // detectors only. The policy decision must be made from structured signals so
  // future changes cannot regress to one literal phrase such as "search" or
  // "内置浏览器".
  return {
    noNetworkConstraint,
    localOnlyConstraint,
    explicitBrowserSearch: explicitBrowserSearchSignal,
    browserReferenceRequest: browserReferenceSignal,
    currentExternalEvidenceNeeded: currentExternalSignal || (lookupIntentSignal && publicTopicSignal),
  };
}

function explicitBrowserSearch(text: string) {
  return /(?:^|[^A-Za-z0-9_])\/browser\s+search(?=$|[^A-Za-z0-9_])/i.test(text)
    || (browserSearchSurfaceMention(text) && browserSearchVerbMention(text))
    || hasAsciiToken(text, 'browser_runtime');
}

function browserRefRequest(text: string) {
  return /(?:^|[^A-Za-z0-9_])(?:browser\s+ref|browser\s+pane|BrowserHostSession)(?=$|[^A-Za-z0-9_])/i.test(text)
    || hasCjkTerm(text, ['网页证据', '浏览器引用', '浏览器面板']);
}

function currentExternalOrCitationRequest(text: string) {
  const asksForEvidence = hasAsciiToken(text, 'cite|citation|sources?|url|link|reference|verify')
    || hasCjkTerm(text, ['引用', '来源', '链接', '验证', '确认', '核实', '查证']);
  const asksForCurrent = hasAsciiToken(text, 'latest|today|recent|real[-\\s]?time|up[-\\s]?to[-\\s]?date|pricing|price|schedule|law|regulation|docs?|paper|product|web|website|external|release|version|changelog')
    || hasCjkTerm(text, ['最新', '实时', '今天', '当前', '现在', '近期', '本周', '现状', '网页', '外部', '价格', '法规', '官方文档', '在线文档', '论文', '版本', '发布']);
  return asksForEvidence || asksForCurrent;
}

function externalLookupIntent(text: string) {
  return hasAsciiToken(text, 'look\\s*up|check|verify|confirm|find\\s+out|what\\s+is|who\\s+is|when\\s+is')
    || /(?:查一下|查询一下|帮我查|帮我确认|确认一下|核实一下|了解一下|看看|搜索|检索|查询|查找).{0,80}/.test(text);
}

function publicExternalTopicSignal(text: string) {
  return hasAsciiToken(text, 'news|situation|conflict|policy|law|regulation|price|pricing|stock|weather|schedule|release|version|changelog|company|product|country|government|election|market')
    || hasCjkTerm(text, [
      '新闻',
      '局势',
      '形势',
      '冲突',
      '政策',
      '法规',
      '价格',
      '股价',
      '天气',
      '日程',
      '版本',
      '发布',
      '公司',
      '产品',
      '国家',
      '政府',
      '选举',
      '市场',
      '进展',
      '大模型',
      '前沿',
      'AI',
      '论文',
      '文章',
      'arxiv',
    ]);
}

function browserSearchQueryFromText(prompt: string): string | undefined {
  const patterns = [
    /\/browser\s+search\s+["“']([^"”']+)["”']/i,
    /(?:browser\s+search|search|query|搜索|检索)\s*[:：]\s*["“']?([^"”'\n。；;]+)/i,
    /(?:请|帮我|帮忙|给我|麻烦)?\s*(?:通过|使用|用)?\s*(?:内置)?\s*(?:浏览器|网页|网络|互联网)?\s*(?:搜索|检索|查询|查找)\s*[:：]?\s*["“']?([^"”'\n。；;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(prompt);
    const value = cleanBrowserSearchQueryCandidate(match?.[1]);
    if (value) return compactText(value, 240);
  }
  return undefined;
}

function naturalLanguageSearchTopicFromPrompt(prompt: string): string | undefined {
  let query = compactText(prompt.replace(/[“”"']/g, ' '), 240);
  if (!query) return undefined;
  const colonQuery = queryAfterSemanticRequestPrefix(query);
  if (colonQuery) query = colonQuery;

  // Semantic query principle: the search topic is the user's information target,
  // not the UI action phrase. These lexical removals are bounded feature cleanup
  // after the structured browser-evidence decision has already been made.
  query = stripBrowserSearchRequestFraming(query);
  query = stripSearchResultPresentationInstructions(query);
  query = query.replace(/^the\s+(?=(?:current|latest|recent)\b)/i, '');
  query = query.replace(/^(?:这个|这条|这篇)?(?:新闻|消息|报道|信息)\s*/i, '');
  query = query.replace(/^(?:the|this)\s+(?:news|article|report)\s*[:：-]?\s*/i, '');
  query = query.replace(/[。；;，,.!?！？\s]+$/g, '').trim();
  return query ? compactText(query, 240) : undefined;
}

function queryAfterSemanticRequestPrefix(text: string): string | undefined {
  const match = /^(.{0,80})[:：]\s*(.+)$/.exec(text);
  if (!match) return undefined;
  const prefix = match[1] ?? '';
  const candidate = cleanBrowserSearchQueryCandidate(match[2]);
  if (!candidate) return undefined;
  if (externalLookupIntent(prefix) || currentExternalOrCitationRequest(prefix) || browserSearchSurfaceMention(prefix)) {
    return candidate;
  }
  return undefined;
}

function stripBrowserSearchRequestFraming(text: string): string {
  let query = text.trim();
  for (let index = 0; index < 3; index += 1) {
    const next = query
      .replace(/^(?:please\s+)?(?:(?:use|using|with|through)\s+(?:the\s+)?(?:built[-\s]?in\s+|in[-\s]?app\s+)?(?:browser|web|internet)\s+)?(?:find\s+out|find|look\s+up|check|verify|confirm|search(?:\s+for)?|query|open|browse)\s+/i, '')
      .replace(/^(?:what|who|when|where)\s+(?:is|are|was|were)\s+/i, '')
      .replace(/^(?:请|帮我|帮忙|给我|麻烦(?:你)?|你能不能|能否|可以)?\s*(?:通过|使用|用)?\s*(?:SciForge\s*)?(?:的)?\s*(?:内置)?\s*(?:浏览器|网页|网络|互联网)?\s*(?:上|里|中)?\s*(?:搜索|检索|查询|查找|查看|看看|了解|确认|核实|查证|查一下|查询一下|打开)\s*(?:一下)?\s*/i, '')
      .trim();
    if (next === query) break;
    query = next;
  }
  return query;
}

function stripSearchResultPresentationInstructions(text: string): string {
  return text
    .replace(/\s+(?:and|then)\s+(?:cite|include|provide|summarize|list|return|show)\b.*$/i, '')
    .replace(/\s+with\s+(?:citations?|sources?|source\s+urls?|links?|references?)\b.*$/i, '')
    .replace(/\s+please\s+(?:cite|include|provide|summarize|list|return|show)\b.*$/i, '')
    .replace(/(?:并|同时|然后|顺便).{0,30}(?:总结|概括|引用|来源|链接|网址|列出|给出|提供).*$/i, '')
    .trim();
}

function browserSearchSurfaceMention(text: string) {
  return hasAsciiToken(text, 'browser|rendered')
    || hasCjkTerm(text, ['浏览器', '内置浏览器', '网页', '网络', '互联网']);
}

function browserSearchVerbMention(text: string) {
  return hasAsciiToken(text, 'search|query')
    || hasCjkTerm(text, ['搜索', '检索', '查询', '查找']);
}

function cleanBrowserSearchQueryCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let query = compactText(value.replace(/[“”"']/g, ' '), 240);
  query = stripSearchResultPresentationInstructions(query);
  query = stripBrowserSearchRequestFraming(query);
  query = query.replace(/^(?:并|同时|然后|顺便)?\s*(?:总结|概括|梳理|汇总)\s*/i, '');
  query = query.replace(/^(?:网页|网络|互联网|浏览器)\s*(?:上|里|中)?\s*(?:查看|看看|搜索|检索|查询|查找)?\s*/i, '');
  query = query.replace(/^(?:查看|看看|了解|查询|搜索|检索|查找|一下)\s*/i, '');
  query = strengthenExplicitSourceConstraint(query);
  query = query.replace(/[。；;，,]+$/g, '').trim();
  return query ? compactText(query, 240) : undefined;
}

function strengthenExplicitSourceConstraint(query: string): string {
  const source = explicitSourceConstraint(query);
  if (!source || /(?:^|\s)site:[^\s]+/i.test(query)) return query;
  let topic = query
    .replace(source.removePattern, ' ')
    .replace(/\s+(?:on|from|in)\s*$/i, '')
    .replace(/\s*(?:上|里|中|网站|站内)\s*$/iu, '')
    .trim();
  topic = stripGenericSearchNounSuffix(topic);
  topic = stripLowInformationTemporalTerms(topic);
  topic = stripGenericSearchNounSuffix(topic);
  topic = stripCjkGenericSearchSuffix(topic);
  return stripCjkGenericSearchSuffix(stripGenericSearchNounSuffix(compactText(`site:${source.domain} ${topic || query}`, 240)));
}

function stripGenericSearchNounSuffix(query: string): string {
  return query
    .replace(/\s*(?:相关|有关)\s*的?\s*(?:文章|论文)\s*$/u, '')
    .replace(/\s*(?:papers?|articles?)\s*$/i, '')
    .trim();
}

function stripCjkGenericSearchSuffix(query: string): string {
  let out = query.trim();
  for (const suffix of ['相关的文章', '相关的论文', '相关文章', '相关论文', '有关的文章', '有关的论文']) {
    if (out.endsWith(suffix)) out = out.slice(0, -suffix.length).trim();
  }
  return out;
}

function finalizeSemanticBrowserSearchQuery(query: string): string {
  return stripCjkGenericSearchSuffix(stripGenericSearchNounSuffix(query));
}

function explicitSourceConstraint(query: string): { domain: string; removePattern: RegExp } | undefined {
  const explicitDomainMatch = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?:\/[^\s]*)?/i.exec(query);
  const explicitDomain = explicitDomainMatch?.[1];
  if (
    explicitDomain
    && !/^(?:www\.)?(?:today|latest|current|recent)\./i.test(explicitDomain)
    && sourceContextAroundMatch(query, explicitDomainMatch)
  ) {
    const escaped = explicitDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { domain: explicitDomain.replace(/^www\./i, ''), removePattern: new RegExp(`\\b(?:www\\.)?${escaped}\\b\\s*(?:上|里|中|网站|站内|官网|官方|site)?`, 'iu') };
  }
  const arxivMatch = /\barxiv(?:\.org)?\b/i.exec(query);
  if (arxivMatch && sourceContextAroundMatch(query, arxivMatch)) {
    return { domain: 'arxiv.org', removePattern: /\barxiv(?:\.org)?\b\s*(?:上|里|中|网站|站内)?/iu };
  }
  const huggingFaceMatch = /\bhugging\s*face\b|\bhuggingface\b/i.exec(query);
  if (huggingFaceMatch && sourceContextAroundMatch(query, huggingFaceMatch)) {
    return { domain: 'huggingface.co', removePattern: /\bhugging\s*face\b|\bhuggingface\b/iu };
  }
  return undefined;
}

function sourceContextAroundMatch(query: string, match: RegExpExecArray | undefined | null): boolean {
  if (!match) return false;
  const start = match.index;
  const end = start + match[0].length;
  const before = query.slice(Math.max(0, start - 16), start);
  const after = query.slice(end, Math.min(query.length, end + 16));
  return /^https?:\/\//i.test(match[0])
    || /https?:\/\/$/i.test(before)
    || /\b(?:on|from|in|at)\s+$/i.test(before)
    || /(?:在|从|来自|去|到)\s*$/u.test(before)
    || /^\s*(?:上|里|中|网站|站内|官网|官方|site)(?:\b|$)?/iu.test(after);
}

function stripLowInformationTemporalTerms(query: string): string {
  const withoutTemporal = query
    .replace(/(?:^|\s)(?:今天|今日|现在|当前|近期|最近(?:一周|一星期|7天)?|近(?:一周|一星期|7天)|过去(?:一周|一星期|7天)|本周|这周)(?=\s|[A-Za-z0-9]|$)/giu, ' ')
    .replace(/\b(?:today|current|recent|latest|this\s+week|last\s+(?:week|7\s+days)|past\s+(?:week|7\s+days))\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutTemporal.length >= 3 ? withoutTemporal : query;
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

function hasAsciiToken(text: string, alternatives: string) {
  return new RegExp(`(?:^|[^A-Za-z0-9_])(?:${alternatives})(?=$|[^A-Za-z0-9_])`, 'i').test(text);
}

function hasCjkTerm(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(term));
}
