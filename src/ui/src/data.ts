import {
  BookOpen,
  Brain,
  Blocks,
  Database,
  Dna,
  FlaskConical,
  GitBranch,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import {
  builtInScenarioDisplayData,
  type ClaimType,
  type EvidenceLevel,
  type ScenarioDisplayIconKey,
  type ScenarioId,
} from '@sciforge/scenario-core/scenario-demo-data';

export type { ClaimType, EvidenceLevel, ScenarioId };

export type PageId = 'workbench' | 'components' | 'timeline' | 'feedback' | 'settings';

export interface ScenarioViewConfig {
  id: ScenarioId;
  name: string;
  domain: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  tools: string[];
  status: 'active' | 'ready';
  defaultResult: string;
}

const scenarioIconByKey: Record<ScenarioDisplayIconKey, LucideIcon> = {
  bookOpen: BookOpen,
  flaskConical: FlaskConical,
  dna: Dna,
  database: Database,
};

export const scenarios: ScenarioViewConfig[] = builtInScenarioDisplayData.map((scenario) => ({
  ...scenario,
  icon: scenarioIconByKey[scenario.icon],
}));

export const navItems = [
  { id: 'workbench' as const, label: '聊天工作台', icon: Brain },
  { id: 'components' as const, label: '应用', icon: Blocks },
  { id: 'timeline' as const, label: '研究时间线', icon: GitBranch },
  { id: 'feedback' as const, label: '反馈收件箱', icon: MessageSquare },
];

/** Primary workspace views shown on the always-visible sidebar activity bar. */
export const sidebarViewNavItems = navItems.filter((item) => item.id !== 'components');
