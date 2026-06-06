export type RequestClarificationReason =
  | 'ambiguous-platform-ranking-target'
  | 'missing-referent';

export type RequestClarificationLanguage = 'zh' | 'en';

export interface RequestClarificationNeed {
  reason: RequestClarificationReason;
  message: string;
  language: RequestClarificationLanguage;
  requiredInputs: string[];
}

export interface RequestClarificationInput {
  prompt: string;
  references?: unknown[];
  artifacts?: unknown[];
  uiState?: unknown;
}

export function resolveRequestClarificationNeed(input: RequestClarificationInput): RequestClarificationNeed | undefined {
  const prompt = cleanText(input.prompt);
  if (!prompt) return undefined;
  const language = /[\u3400-\u9fff]/u.test(prompt) ? 'zh' : 'en';
  const platformRanking = ambiguousPlatformRankingTarget(prompt, language);
  if (platformRanking) return platformRanking;
  if (missingReferent(prompt, input, language)) {
    return {
      reason: 'missing-referent',
      language,
      requiredInputs: language === 'zh'
        ? ['具体对象', '对象类型', '当前位置或引用']
        : ['specific object', 'object type', 'current selection or reference'],
      message: language === 'zh'
        ? '我需要先确认“这个”具体指什么对象：文件、页面、选中文本、报错，还是某条聊天消息？请补充对象或选择引用后我再继续。'
        : 'I need to confirm what "this" refers to first: a file, page, selected text, error, or a prior message? Please provide the object or select a reference before I continue.',
    };
  }
  return undefined;
}

function ambiguousPlatformRankingTarget(
  prompt: string,
  language: RequestClarificationLanguage,
): RequestClarificationNeed | undefined {
  const platform = rankedPlatformLabel(prompt);
  if (!platform) return undefined;
  const asksForRanking = /\b(?:top|trending|popular|hottest|best|latest|today|daily)\b/i.test(prompt)
    || /(?:最火|最热|热门|趋势|榜单|排行|今天|今日|最新|日榜)/.test(prompt);
  if (!asksForRanking) return undefined;
  const hasSpecificTarget = /\b(?:papers?|models?|datasets?|spaces?|jobs?|职位|岗位|招聘|论文|模型|数据集|空间|应用)\b/i.test(prompt);
  if (hasSpecificTarget) return undefined;
  const hasGenericTarget = /\b(?:work|works|thing|things|stuff|content|project|projects|resource|resources|item|items)\b/i.test(prompt)
    || /(?:工作|东西|内容|项目|资源|作品|任务|条目)/.test(prompt);
  if (!hasGenericTarget) return undefined;
  return {
    reason: 'ambiguous-platform-ranking-target',
    language,
    requiredInputs: ['target category', 'ranking surface'],
    message: language === 'zh'
      ? `我需要先确认你说的“工作”具体指 ${platform} 上哪类对象：Daily Papers/papers、models、datasets、Spaces，还是 jobs/职位？确认范围后我再搜索，并在打开来源页面读完正文后总结。`
      : `I need to clarify what kind of work you mean on ${platform}: Daily Papers/papers, models, datasets, Spaces, or jobs? Once you confirm the scope, I will search and read the source pages before summarizing.`,
  };
}

function rankedPlatformLabel(prompt: string): string | undefined {
  if (/(?:hugging\s*face|huggingface|\bhf\b)/i.test(prompt)) return 'Hugging Face';
  if (/\bgithub\b/i.test(prompt)) return 'GitHub';
  if (/\barxiv\b/i.test(prompt)) return 'arXiv';
  if (/\bpapers\s*with\s*code\b/i.test(prompt)) return 'Papers with Code';
  if (/\bkaggle\b/i.test(prompt)) return 'Kaggle';
  if (/\bproduct\s*hunt\b/i.test(prompt)) return 'Product Hunt';
  if (/\breddit\b/i.test(prompt)) return 'Reddit';
  if (/\b(?:twitter|x\.com)\b/i.test(prompt)) return 'X/Twitter';
  return undefined;
}

function missingReferent(
  prompt: string,
  input: RequestClarificationInput,
  language: RequestClarificationLanguage,
) {
  if (requestHasCurrentReference(input)) return false;
  if (containsConcreteTarget(prompt)) return false;
  if (language === 'zh') {
    return /(?:帮我|请|麻烦)?\s*(?:处理|修改|修复|总结|解释|分析|看看|打开|整理)\s*(?:一下)?\s*(?:这个|这|它|这里|上面)\s*$/i.test(prompt);
  }
  return /\b(?:fix|handle|process|summari[sz]e|explain|analy[sz]e|open|look\s+at)\s+(?:this|that|it|here)\s*$/i.test(prompt);
}

function requestHasCurrentReference(input: RequestClarificationInput) {
  if ((input.references ?? []).length > 0) return true;
  if ((input.artifacts ?? []).length > 0) return true;
  const uiState = input.uiState;
  if (!uiState || typeof uiState !== 'object') return false;
  const refs = (uiState as { currentReferences?: unknown }).currentReferences;
  return Array.isArray(refs) && refs.length > 0;
}

function containsConcreteTarget(prompt: string) {
  return /\b(?:[\w.-]+\/[\w./-]+|[\w.-]+\.(?:ts|tsx|js|jsx|py|md|json|csv|txt|docx?|xlsx?|pptx?|pdf|png|jpe?g|webp))\b/i.test(prompt)
    || /\bhttps?:\/\//i.test(prompt)
    || /[:：]\s*\S+/.test(prompt)
    || /(?:文件|页面|链接|网址|报错|错误|截图|选中|引用|artifact|reference|error|file|page|selection)/i.test(prompt);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
