import type { ToolPackageManifest } from './types';

export const toolPackageManifests = [
  {
    "id": "clawhub.playwright-mcp",
    "packageName": "@bioagent-tool/playwright-mcp",
    "kind": "tool",
    "version": "1.0.0",
    "label": "playwright-mcp",
    "description": "Browser automation MCP server backed by Playwright for structured page inspection, navigation, form input, and self-healing browser workflows.",
    "source": "package",
    "toolType": "connector",
    "skillDomains": [
      "knowledge"
    ],
    "producesArtifactTypes": [
      "structure-summary"
    ],
    "requiredConfig": [],
    "docs": {
      "readmePath": "packages/tools/clawhub/playwright-mcp/SKILL.md",
      "agentSummary": "Browser automation MCP server backed by Playwright for structured page inspection, navigation, form input, and self-healing browser workflows."
    },
    "packageRoot": "packages/tools/clawhub/playwright-mcp",
    "tags": [
      "package",
      "clawhub",
      "knowledge",
      "browser",
      "automation",
      "mcp",
      "playwright"
    ],
    "provider": "clawhub",
    "sourceUrl": "https://clawhub.ai/spiceman161/playwright-mcp",
    "mcpCommand": "npx",
    "mcpArgs": [
      "@playwright/mcp@latest"
    ]
  }
] as const satisfies readonly ToolPackageManifest[];

export type { ToolPackageManifest, ToolPackageSource } from './types';
