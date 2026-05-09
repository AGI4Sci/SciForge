import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  Blocks,
  Database,
  Dna,
  FileText,
  FlaskConical,
  GitBranch,
  MessageSquare,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import {
  alignmentFeasibilityRows,
  alignmentRadarData,
} from '@sciforge/scenario-core/alignment-display-policy';
import {
  builtInScenarioDisplayData,
  overviewStats,
  type ClaimType,
  type EvidenceLevel,
  type OverviewStatIconKey,
  type ScenarioDisplayIconKey,
  type ScenarioId,
} from '@sciforge/scenario-core/scenario-demo-data';

export type { ClaimType, EvidenceLevel, ScenarioId };

export type PageId = 'dashboard' | 'workbench' | 'components' | 'timeline' | 'feedback';

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

const overviewIconByKey: Record<OverviewStatIconKey, LucideIcon> = {
  brain: Brain,
  shield: Shield,
  fileText: FileText,
  barChart3: BarChart3,
};

export const scenarios: ScenarioViewConfig[] = builtInScenarioDisplayData.map((scenario) => ({
  ...scenario,
  icon: scenarioIconByKey[scenario.icon],
}));

export const navItems = [
  { id: 'dashboard' as const, label: '研究概览', icon: Activity },
  { id: 'workbench' as const, label: '场景工作台', icon: Brain },
  { id: 'components' as const, label: '组件工作台', icon: Blocks },
  { id: 'timeline' as const, label: '研究时间线', icon: GitBranch },
  { id: 'feedback' as const, label: '反馈收件箱', icon: MessageSquare },
];

export const stats = overviewStats.map((stat) => ({
  ...stat,
  icon: overviewIconByKey[stat.icon],
}));

export const feasibilityRows = alignmentFeasibilityRows;
export const radarData = alignmentRadarData;
