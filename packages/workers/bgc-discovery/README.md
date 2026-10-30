# SciForge BGC Discovery Worker

First-party MCP worker for BGC-side genome mining workflows.

The first version focuses on a controlled, auditable BGC pipeline:

```text
genome or existing antiSMASH output
  -> antiSMASH region parsing
  -> optional MIBiG enrichment
  -> optional BiG-SCAPE family enrichment
  -> Candidate BGC Cards
  -> rule ranking
  -> workspace-local report artifacts
```

It intentionally treats LLMs as SciForge Runtime orchestration and
interpretation layers. The worker itself produces structured evidence cards and
does not call upstream model providers directly.

## Tools

- `bgc_status` reports configured paths and whether expected local tools are discoverable.
- `bgc_plan` explains the recommended workflow for the current inputs.
- `bgc_resource_status` reports registered local BGC resources, cache paths, executable availability, and install plans.
- `bgc_register_resource` registers an existing executable, database, result folder, or source URL without bundling it into SciForge.
- `bgc_download_resource` downloads HTTPS resources into a local cache, optionally extracts archives, and registers the resulting path.
- `bgc_run_pipeline` builds cards, rankings, and reports under `outputs/bgc-discovery`.

Optional antiSMASH execution is disabled unless `runAntismash: true` is passed.

## Resource strategy

SciForge does not bundle large bioinformatics tools or databases. The worker
uses this order:

1. Prefer existing antiSMASH and BiG-SCAPE result directories when provided.
2. Use registered local resources, such as a MIBiG JSON cache or executable path.
3. Download small HTTPS resources such as MIBiG JSON into a local cache.
4. Provide install plans for heavy tools such as antiSMASH and BiG-SCAPE; it does
   not execute arbitrary installers.

The resource registry is stored at
`outputs/bgc-discovery/resources/resource-registry.json`.

Downloads are restricted to workspace-local destinations, enforce a timeout and
size limit, and reject archives with traversal paths or link entries before
extraction.
