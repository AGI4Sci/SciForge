# SciForge Research Search

Shared MCP server for scientific research discovery. It exposes `research_search` over stdio so any runtime that can connect to MCP can use the same research pipeline.

## Start

```bash
npm --workspace @sciforge/search run start
```

## MCP Tool

- `research_search`: searches configured scientific sources, expands the query, ranks duplicate paper results, and returns structured evidence for an assistant to synthesize.

## Configuration

Environment variables:

- `SCIFORGE_RESEARCH_ARXIV_ENABLED`: default `true`
- `SCIFORGE_RESEARCH_BIORXIV_ENABLED`: default `true`
- `SCIFORGE_RESEARCH_EUROPE_PMC_ENABLED`: default `true`
- `SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_ENABLED`: default `true`
- `SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_API_KEY`: optional
- `SCIFORGE_RESEARCH_TAVILY_ENABLED`: default `true` when a Tavily key is present
- `SCIFORGE_RESEARCH_TAVILY_API_KEY` or `TAVILY_API_KEY`: optional, required for Tavily and CNS web search
- `SCIFORGE_RESEARCH_CNS_ENABLED`: default `true` when a Tavily key is present
- `SCIFORGE_RESEARCH_CNS_DOMAINS`: comma-separated domains, default `nature.com,science.org,cell.com`
- `SCIFORGE_RESEARCH_MAX_RESULTS`: default `10`
- `SCIFORGE_RESEARCH_TIMEOUT_MS`: default `15000`
- `SCIFORGE_RESEARCH_DEFAULT_SINCE_YEAR`: optional

Example MCP config:

```json
{
  "mcpServers": {
    "sciforge-research": {
      "command": "npm",
      "args": ["--workspace", "@sciforge/search", "run", "start"]
    }
  }
}
```
