import type { ScenarioId } from '../data';
import type { ObjectReference, SciForgeRun, SciForgeSession, UIManifestSlot, ViewPlanSection } from '../domain';
import type { ResultFocusMode } from './results/ResultShell';
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
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  defaultSlots?: UIManifestSlot[];
  activeRun?: SciForgeRun;
  focusedObjectReference?: ObjectReference;
  pinnedObjectReferences?: ObjectReference[];
  focusMode: ResultFocusMode;
}): ResultsRendererViewModel {
  const viewPlan = resolveViewPlan({
    scenarioId,
    session,
    defaultSlots,
    activeRun,
    focusedObjectReference,
    pinnedObjectReferences,
  });
  return projectResultsRendererViewModel({ session, activeRun, viewPlan, focusMode });
}

export function projectResultsRendererViewModel({
  session,
  activeRun,
  viewPlan,
  focusMode,
}: {
  session: SciForgeSession;
  activeRun?: SciForgeRun;
  viewPlan: RuntimeResolvedViewPlan;
  focusMode: ResultFocusMode;
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
    primaryTitle: primaryResultSectionTitle(focusMode),
    visibleItems,
    deferredItems,
    deferredSections: projectDeferredSections(deferredItems),
    emptyState: planItems.length ? undefined : emptyResultsState(focusMode, dismissedAllInFilter, presentationState),
    auditOpen: shouldOpenRunAuditDetails(session, activeRun),
    auditDefaultOpen: shouldDefaultOpenRunAuditDetails(session, activeRun),
    manifestDiagnostics: projectManifestDiagnostics(viewPlan.allItems),
  };
}

export function primaryResultSectionTitle(focusMode: ResultFocusMode) {
  if (focusMode === 'execution') return '过程记录';
  if (focusMode === 'evidence') return '证据重点';
  return '核心结果';
}

export function emptyResultsState(focusMode: ResultFocusMode, dismissedAllInFilter: boolean, presentationState?: RunPresentationState): ResultsRendererEmptyStateModel {
  if (dismissedAllInFilter) {
    return {
      title: '当前筛选下的视图已全部从界面移除',
      detail: '这只影响当前呈现，已生成内容和工作区文件不会被删除。新开聊天会清空该列表。',
      dismissedAllInFilter,
    };
  }
  if (focusMode === 'all') {
    if (presentationState && (presentationState.kind !== 'ready' || presentationState.reason)) {
      if (presentationState.kind === 'empty') {
        return {
          title: '暂无可预览内容',
          detail: supportPaneEmptyDetail(presentationState),
          dismissedAllInFilter,
          recoverActions: [],
        };
      }
      return {
        title: presentationState.title,
        detail: [
          presentationState.reason,
          presentationState.nextSteps.length ? `下一步：${presentationState.nextSteps[0]}` : undefined,
        ].filter(Boolean).join(' '),
        dismissedAllInFilter,
        recoverActions: [],
      };
    }
    return {
      title: '还没有可展示的关键结果',
      detail: '主回答优先保留在聊天中；有可预览内容时会显示在这里。',
      dismissedAllInFilter,
      recoverActions: [],
    };
  }
  return {
    title: '当前筛选没有匹配内容',
    detail: '切回“全部”，或运行一个会生成对应结果的任务。',
    dismissedAllInFilter,
    recoverActions: [],
  };
}

export function projectDeferredSections(items: ResolvedViewPlanItem[]): ResultsRendererSectionModel[] {
  return deferredSectionOrder
    .map((section) => ({
      section,
      title: resultsSectionTitle(section),
      items: items.filter((item) => item.section === section),
    }))
    .filter((section) => section.items.length > 0);
}

export function projectManifestDiagnostics(items: ResolvedViewPlanItem[]): ResultsRendererManifestDiagnostic[] {
  return items.map((item) => ({
    id: item.id,
    label: item.slot.title ?? item.module.title ?? '展示项',
    detail: item.reason ?? item.module.description,
    status: item.status,
  }));
}

function resultsSectionTitle(section: ViewPlanSection) {
  if (section === 'provenance') return '过程记录';
  if (section === 'raw') return '补充材料';
  return viewPlanSectionLabel(section);
}

function supportPaneEmptyDetail(presentationState: RunPresentationState) {
  if (/折叠过程|执行记录|校验|恢复线索/.test(presentationState.reason)) {
    return '主回答优先保留在聊天中；过程记录、验证和恢复线索已折叠保留。';
  }
  return '主回答优先保留在聊天中；有可预览内容时会显示在这里。';
}

export { selectDefaultResultItems, viewPlanSectionLabel };
export type { ResolvedViewPlanItem, RuntimeResolvedViewPlan };
