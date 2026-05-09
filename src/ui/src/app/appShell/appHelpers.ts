import { scenarios } from '../../data';
import type { FeedbackCommentRecord, FeedbackCommentStatus, ScenarioInstanceId, SciForgeConfig } from '../../domain';
import { defaultSciForgeConfig, updateConfig } from '../../config';
import { makeId } from '../../domain';

const FEEDBACK_AUTHOR_KEY = 'sciforge.feedback.author.v1';
export const APP_BUILD_ID = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'local-dev';

export function loadFeedbackAuthor() {
  if (typeof window === 'undefined') return { authorId: 'local-user', authorName: 'Local User' };
  try {
    const raw = window.localStorage.getItem(FEEDBACK_AUTHOR_KEY);
    if (raw) {
      const value = JSON.parse(raw) as { authorId?: unknown; authorName?: unknown };
      if (typeof value.authorId === 'string' && typeof value.authorName === 'string') {
        return { authorId: value.authorId, authorName: value.authorName };
      }
    }
  } catch {
    // Fall through to a stable browser-local author.
  }
  const author = { authorId: makeId('feedback-user'), authorName: 'Local User' };
  saveFeedbackAuthor(author);
  return author;
}

export function saveFeedbackAuthor(author: { authorId: string; authorName: string }) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FEEDBACK_AUTHOR_KEY, JSON.stringify(author));
  } catch {
    // Feedback capture still works without local author persistence.
  }
}

export function hasUsableModelConfig(config: SciForgeConfig) {
  const provider = config.modelProvider.trim() || 'native';
  if (provider === 'native') {
    return Boolean(config.modelName.trim() || config.modelBaseUrl.trim() || config.apiKey.trim());
  }
  return Boolean(config.modelBaseUrl.trim() && config.apiKey.trim());
}

export function mergeFileBackedConfig(current: SciForgeConfig, fileConfig: SciForgeConfig): SciForgeConfig {
  const preserve: Partial<SciForgeConfig> = {};
  const currentHasModel = hasUsableModelConfig(current);
  const fileHasModel = hasUsableModelConfig(fileConfig);
  if (currentHasModel && !fileHasModel) {
    preserve.modelProvider = current.modelProvider;
    preserve.modelBaseUrl = current.modelBaseUrl;
    preserve.modelName = current.modelName;
    preserve.apiKey = current.apiKey;
  }
  if (current.feedbackGithubToken?.trim() && !fileConfig.feedbackGithubToken?.trim()) {
    preserve.feedbackGithubToken = current.feedbackGithubToken;
  }
  const fileRepoIsDefault = !fileConfig.feedbackGithubRepo?.trim()
    || fileConfig.feedbackGithubRepo.trim() === defaultSciForgeConfig.feedbackGithubRepo;
  if (current.feedbackGithubRepo?.trim()
    && current.feedbackGithubRepo.trim() !== defaultSciForgeConfig.feedbackGithubRepo
    && fileRepoIsDefault) {
    preserve.feedbackGithubRepo = current.feedbackGithubRepo;
  }
  return Object.keys(preserve).length ? updateConfig(fileConfig, preserve) : fileConfig;
}

export function formatSessionTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'unknown time';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

export function requestTitleFromFeedback(comments: FeedbackCommentRecord[]) {
  const first = comments[0]?.comment.trim();
  return first ? first.slice(0, 48) : 'SciForge feedback request';
}

export function feedbackStatusVariant(status: FeedbackCommentStatus): 'info' | 'success' | 'warning' | 'danger' | 'muted' {
  if (status === 'fixed') return 'success';
  if (status === 'planned' || status === 'triaged') return 'info';
  if (status === 'needs-discussion') return 'warning';
  if (status === 'wont-fix') return 'danger';
  return 'muted';
}

export function scenarioLabelForInstance(scenarioId: ScenarioInstanceId) {
  return scenarios.find((item) => item.id === scenarioId)?.name ?? String(scenarioId);
}
