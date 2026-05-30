import {
  BookOpen,
  Blocks,
  Database,
  Dna,
  FlaskConical,
  GitBranch,
  Globe2,
  Inbox,
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

export type PageId = 'workbench' | 'components' | 'timeline' | 'feedback' | 'browser' | 'settings';

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
  { id: 'workbench' as const, label: 'Chat', icon: MessageSquare },
  { id: 'components' as const, label: 'Apps', icon: Blocks },
  { id: 'browser' as const, label: 'Browser', icon: Globe2 },
  { id: 'timeline' as const, label: 'Timeline', icon: GitBranch },
  { id: 'feedback' as const, label: 'Feedback', icon: Inbox },
];

/** Primary workspace views shown on the always-visible sidebar activity bar. */
export const sidebarViewNavItems = navItems.filter((item) => item.id !== 'components');
