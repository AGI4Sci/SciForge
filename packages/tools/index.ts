import type { ToolPackageManifest } from './types';

export const toolPackageManifests = [
  {
    "id": "clawhub.playwright-mcp",
    "packageName": "@sciforge-tool/playwright-mcp",
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
  },
  {
    "id": "local.vision-sense",
    "packageName": "@sciforge-tool/vision-sense",
    "kind": "tool",
    "version": "1.0.0",
    "label": "vision-sense",
    "description": "Vision Sense Plugin for turning text plus screenshot/image modalities into text-only visual observations and auditable vision traces.",
    "source": "package",
    "toolType": "sense-plugin",
    "skillDomains": [
      "knowledge"
    ],
    "producesArtifactTypes": [
      "vision-trace"
    ],
    "requiredConfig": [
      "shared-llm-config",
      "kv-ground-base-url",
      "trace-output-dir"
    ],
    "docs": {
      "readmePath": "packages/tools/local/vision-sense/SKILL.md",
      "agentSummary": "Vision Sense Plugin for turning text plus screenshot/image modalities into text-only visual observations and auditable vision traces. Computer Use execution is owned by a separate modular consumer/provider."
    },
    "packageRoot": "packages/senses/vision-sense",
    "tags": [
      "package",
      "local",
      "knowledge",
      "vision",
      "modality:vision",
      "grounding",
      "text-output",
      "computer-use-input",
      "kv-ground"
    ],
    "provider": "local",
    "sensePlugin": {
      "id": "sciforge.vision-sense",
      "modality": "vision",
      "inputContract": {
        "textField": "text",
        "modalitiesField": "modalities",
        "acceptedModalities": [
          "screenshot",
          "image"
        ]
      },
      "outputContract": {
        "kind": "text",
        "formats": [
          "application/json",
          "application/x-ndjson",
          "text/plain"
        ]
      },
      "executionBoundary": "text-signal-only",
      "safety": {
        "defaultRiskLevel": "low",
        "highRiskPolicy": "reject"
      }
    }
  }
] as const satisfies readonly ToolPackageManifest[];

export type { SensePluginManifest, ToolPackageManifest, ToolPackageSource } from './types';
