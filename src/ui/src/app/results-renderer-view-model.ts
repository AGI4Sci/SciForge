import type { ScenarioId } from '../data';
import type { ObjectReference, SciForgeRun, SciForgeSession, UIManifestSlot, ViewPlanSection } from '../domain';
import type { ResultFocusMode } from './results/ResultShell';
import { resultText, type ResultLocale } from './results/resultLocale';
import {
  filterHiddenResultSlots,
  itemsForFocusMode,
  resolveViewPlan,
  selectDefaultResultItems,
  viewPlanSectionLabel,
  type ResolvedViewPlanItem,
  type RuntimeResolvedViewPlan,
} from './results/viewPlanResolver';
import { runPresentationState, shouldDefaultOpenRunAuditDetails, shouldOpenRunAuditDetails, type RunPresentationState } from './results-renderer-execution-model';

const deferredSectionOrder: ViewPlanSection[] = ['supporting', 'provenance', 'raw', 'primary'];

export type ResultsRendererEmptyStateModel = {
  title: string;
  detail: string;
  dismissedAllInFilter: boolean;
  recoverActions?: string[];
};

export type ResultsRendererSectionModel = {
  section: ViewPlanSection;
  title: string;
  items: ResolvedViewPlanItem[];
};

export type ResultsRendererManifestDiagnostic = {
  id: string;
  label: string;
  detail?: string;
  status: string;
};

export type ResultsRendererViewModel = {
  viewPlan: RuntimeResolvedViewPlan;
  primaryTitle: string;
  visibleItems: ResolvedViewPlanItem[];
  deferredItems: ResolvedViewPlanItem[];
  deferredSections: ResultsRendererSectionModel[];
  emptyState?: ResultsRendererEmptyStateModel;
  auditOpen: boolean;
  auditDefaultOpen: boolean;
  manifestDiagnostics: ResultsRendererManifestDiagnostic[];
};

export function createResultsRendererViewModel({
  scenarioId,
  session,
  defaultSlots,
  activeRun,
  focusedObjectReference,
  pinnedObjectReferences = [],
  focusMode,
  locale,
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  defaultSlots?: UIManifestSlot[];
  activeRun?: SciForgeRun;
  focusedObjectReference?: ObjectReference;
  pinnedObjectReferences?: ObjectReference[];
  focusMode: ResultFocusMode;
  locale?: ResultLocale;
}): ResultsRendererViewModel {
  const viewPlan = resolveViewPlan({
    scenarioId,
    session,
    defaultSlots,
    activeRun,
    focusedObjectReference,
    pinnedObjectReferences,
  });
  return projectResultsRendererViewModel({ session, activeRun, viewPlan, focusMode, locale });
}

export function projectResultsRendererViewModel({
  session,
  activeRun,
  viewPlan,
  focusMode,
  locale,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  focusMode: ResultFocusMode;
  locale?: ResultLocale;
}): ResultsRendererViewModel {
  const slotLimit = focusMode === 'visual' || focusMode === 'all' ? 8 : 4;
  const focusModeItems = itemsForFocusMode(viewPlan, focusMode);
  const visibleAfterDismiss = filterHiddenResultSlots(focusModeItems, session, activeRun);
  const planItems = visibleAfterDismiss.slice(0, slotLimit);
  const dismissedAllInFilter = focusModeItems.length > 0 && visibleAfterDismiss.length === 0;
  const { visibleItems, deferredItems } = selectDefaultResultItems(planItems, focusMode);
  const presentationState = runPresentationState(session, activeRun, viewPlan);
  return {
    viewPlan,
    primaryTitle: primaryResultSectionTitle(focusMode, locale),
    visibleItems,
    deferredItems,
    deferredSections: projectDeferredSections(deferredItems, locale),
    emptyState: planItems.length ? undefined : emptyResultsState(focusMode, dismissedAllInFilter, presentationState, locale),
    auditOpen: shouldOpenRunAuditDetails(session, activeRun),
    auditDefaultOpen: shouldDefaultOpenRunAuditDetails(session, activeRun),
    manifestDiagnostics: projectManifestDiagnostics(viewPlan.allItems),
  };
}

export function primaryResultSectionTitle(focusMode: ResultFocusMode, locale?: ResultLocale) {
  if (focusMode === 'execution') return resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' });
  if (focusMode === 'evidence') return resultText(locale, { 'zh-CN': '来源', 'en-US': 'Sources' });
  return resultText(locale, { 'zh-CN': '结果', 'en-US': 'Results' });
}

export function emptyResultsState(focusMode: ResultFocusMode, dismissedAllInFilter: boolean, presentationState?: RunPresentationState, locale?: ResultLocale): ResultsRendererEmptyStateModel {
  if (dismissedAllInFilter) {
    return {
      title: resultText(locale, { 'zh-CN': '此筛选条件下的视图都已隐藏', 'en-US': 'All views are hidden for this filter' }),
      detail: resultText(locale, { 'zh-CN': '这只会改变当前展示，已生成内容和工作区文件仍然可用。', 'en-US': 'This only changes the current presentation. Generated content and workspace files remain available.' }),
      dismissedAllInFilter,
    };
  }
  if (focusMode === 'all') {
    if (presentationState && (presentationState.kind !== 'ready' || presentationState.reason)) {
      if (presentationState.kind === 'empty') {
        return {
          title: resultText(locale, { 'zh-CN': '还没有可预览内容', 'en-US': 'Nothing to preview yet' }),
          detail: supportPaneEmptyDetail(presentationState, locale),
          dismissedAllInFilter,
          recoverActions: [],
        };
      }
      return {
        title: presentationState.title,
        detail: [
          presentationState.reason,
          presentationState.nextSteps.length ? `${resultText(locale, { 'zh-CN': '下一步', 'en-US': 'Next' })}: ${presentationState.nextSteps[0]}` : undefined,
        ].filter(Boolean).join(' '),
        dismissedAllInFilter,
        recoverActions: [],
      };
    }
    return {
      title: resultText(locale, { 'zh-CN': '还没有主要结果', 'en-US': 'No primary result yet' }),
      detail: resultText(locale, { 'zh-CN': '主回答保留在聊天中。可预览的文件和结果会在可用时显示在这里。', 'en-US': 'The main answer stays in chat. Previewable files and artifacts appear here when available.' }),
      dismissedAllInFilter,
      recoverActions: [],
    };
  }
  return {
    title: resultText(locale, { 'zh-CN': '没有匹配内容', 'en-US': 'No matching content' }),
    detail: resultText(locale, { 'zh-CN': '切回“全部”，或运行会生成此类结果的任务。', 'en-US': 'Switch back to All, or run a task that produces this kind of result.' }),
    dismissedAllInFilter,
    recoverActions: [],
  };
}

export function projectDeferredSections(items: ResolvedViewPlanItem[], locale?: ResultLocale): ResultsRendererSectionModel[] {
  return deferredSectionOrder
    .map((section) => ({
      section,
      title: resultsSectionTitle(section, locale),
      items: items.filter((item) => item.section === section),
    }))
    .filter((section) => section.items.length > 0);
}

export function projectManifestDiagnostics(items: ResolvedViewPlanItem[]): ResultsRendererManifestDiagnostic[] {
  return items.map((item) => ({
    id: item.id,
    label: item.slot.title ?? item.module.title ?? 'View',
    detail: item.reason ?? item.module.description,
    status: item.status,
  }));
}

function resultsSectionTitle(section: ViewPlanSection, locale?: ResultLocale) {
  if (section === 'primary') return resultText(locale, { 'zh-CN': '主要结果', 'en-US': 'Primary' });
  if (section === 'supporting') return resultText(locale, { 'zh-CN': '来源', 'en-US': 'Sources' });
  if (section === 'provenance') return resultText(locale, { 'zh-CN': '活动', 'en-US': 'Activity' });
  if (section === 'raw') return resultText(locale, { 'zh-CN': '更多', 'en-US': 'More' });
  return viewPlanSectionLabel(section);
}

function supportPaneEmptyDetail(presentationState: RunPresentationState, locale?: ResultLocale) {
  if (/折叠过程|执行记录|校验|恢复线索/.test(presentationState.reason)) {
    return resultText(locale, { 'zh-CN': '主回答保留在聊天中。工作记录、检查和恢复线索会折叠在这里。', 'en-US': 'The main answer stays in chat. Work records, checks, and recovery notes are folded here.' });
  }
  return resultText(locale, { 'zh-CN': '主回答保留在聊天中。可预览的文件和结果会在可用时显示在这里。', 'en-US': 'The main answer stays in chat. Previewable files and artifacts appear here when available.' });
}

export { selectDefaultResultItems, viewPlanSectionLabel };
export type { ResolvedViewPlanItem, RuntimeResolvedViewPlan };
