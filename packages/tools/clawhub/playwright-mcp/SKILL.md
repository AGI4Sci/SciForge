---
name: playwright-mcp
description: Browser automation MCP server backed by Playwright for structured page inspection, navigation, form input, and self-healing browser workflows.
metadata:
  provider: clawhub
  sourceUrl: https://clawhub.ai/spiceman161/playwright-mcp
  upstreamUrl: https://github.com/microsoft/playwright-mcp
  toolType: connector
  mcpCommand: npx
  mcpArgs: ["@playwright/mcp@latest"]
  tags: browser, automation, mcp, playwright
---

# playwright-mcp

## Agent quick contract

- Kind: tool. This is an executable resource a skill may call; it is not itself the user-facing work strategy.
- Boundary: skills decide when browser automation is needed; this tool provides the Playwright MCP execution surface.
- Runtime: start through an MCP client using command `npx` with args `["@playwright/mcp@latest"]`.
- Best for: browser navigation, DOM/accessibility-tree inspection, form filling, interaction replay, and validating local web applications.
- Avoid using it as the default reasoning path for text-only tasks, offline file transforms, or workflows where a direct CLI/test runner is cheaper.

## Execution contract

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

## Human notes

Playwright MCP exposes browser automation as MCP tools. It is useful when an agent needs persistent browser state, structured page introspection, and interactive web operations. For deterministic CI-style checks, prefer the repository's direct Playwright or test runner scripts when available; use this tool when the workflow benefits from live browser control.

Source package requested from ClawHub: https://clawhub.ai/spiceman161/playwright-mcp
Upstream reference: https://github.com/microsoft/playwright-mcp
